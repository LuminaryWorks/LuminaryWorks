import {
  createCipheriv,
  createDecipheriv,
  createSign,
  createVerify,
  type KeyObject,
  randomBytes,
} from "node:crypto";
import { EntitlementException } from "../../common/errors";
import {
  loadPublicKey,
  parsePlatformCertificatesJson,
  type WechatPayV3Credentials,
} from "../../common/payment-credentials";

export const WECHAT_AUTH_SCHEME = "WECHATPAY2-SHA256-RSA2048";
export const WECHAT_AEAD = "AEAD_AES_256_GCM";
export const WECHAT_NOTIFY_TOLERANCE_SEC = 300;

export function wechatOutTradeNo(attemptId: string): string {
  if (/^[A-Za-z0-9_-]{6,32}$/.test(attemptId)) return attemptId;
  const compact = attemptId.replaceAll("-", "");
  if (/^[A-Za-z0-9]{6,32}$/.test(compact)) return compact;
  throw new EntitlementException(
    "VALIDATION_ERROR",
    "WeChat out_trade_no must be 6–32 alphanumeric characters (attempt id)",
  );
}

export function wechatAttemptIdFromOutTradeNo(outTradeNo: string): string {
  if (/^[0-9a-f]{32}$/i.test(outTradeNo)) {
    return `${outTradeNo.slice(0, 8)}-${outTradeNo.slice(8, 12)}-${outTradeNo.slice(12, 16)}-${outTradeNo.slice(16, 20)}-${outTradeNo.slice(20)}`;
  }
  return outTradeNo;
}

export function wechatSignMessage(
  method: string,
  urlPathWithQuery: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return `${method}\n${urlPathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`;
}

export function signWechatRequest(message: string, privateKey: KeyObject): string {
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  return signer.sign(privateKey, "base64");
}

export function wechatAuthorization(input: {
  mchid: string;
  nonce: string;
  signature: string;
  timestamp: string;
  serial: string;
}): string {
  return `${WECHAT_AUTH_SCHEME} mchid="${input.mchid}",nonce_str="${input.nonce}",signature="${input.signature}",timestamp="${input.timestamp}",serial_no="${input.serial}"`;
}

export function wechatNotifyMessage(timestamp: string, nonce: string, body: string): string {
  return `${timestamp}\n${nonce}\n${body}\n`;
}

export function verifyWechatSignature(
  message: string,
  signatureB64: string,
  publicKey: KeyObject,
): boolean {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(message);
    return verifier.verify(publicKey, signatureB64, "base64");
  } catch {
    return false;
  }
}

export function assertFreshWechatTimestamp(timestamp: string, now: Date): void {
  if (!/^\d{10,12}$/.test(timestamp)) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "WeChat notification timestamp is malformed",
    );
  }
  const ts = Number(timestamp);
  const nowSec = Math.floor(now.getTime() / 1000);
  const delta = Math.abs(nowSec - ts);
  if (delta > WECHAT_NOTIFY_TOLERANCE_SEC) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "WeChat notification timestamp is stale",
    );
  }
}

export function encryptWechatResource(
  plaintext: string,
  apiV3Key: string,
  associatedData: string,
  nonce = randomBytes(6).toString("hex"),
): { ciphertext: string; nonce: string; associated_data: string; algorithm: string } {
  const iv = Buffer.from(nonce, "utf8");
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const packed = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return {
    algorithm: WECHAT_AEAD,
    ciphertext: packed.toString("base64"),
    nonce,
    associated_data: associatedData,
  };
}

export function decryptWechatResource(
  resource: {
    algorithm?: string;
    ciphertext?: string;
    nonce?: string;
    associated_data?: string;
  },
  apiV3Key: string,
): string {
  if ((resource.algorithm ?? WECHAT_AEAD) !== WECHAT_AEAD) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "WeChat resource algorithm must be AEAD_AES_256_GCM",
    );
  }
  const ciphertextB64 = resource.ciphertext ?? "";
  const nonce = resource.nonce ?? "";
  const aad = resource.associated_data ?? "";
  if (!ciphertextB64 || !nonce) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "WeChat resource ciphertext is missing",
    );
  }
  try {
    const packed = Buffer.from(ciphertextB64, "base64");
    if (packed.length < 17) throw new Error("short");
    const data = packed.subarray(0, packed.length - 16);
    const tag = packed.subarray(packed.length - 16);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(apiV3Key, "utf8"),
      Buffer.from(nonce, "utf8"),
    );
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "WeChat resource AES-256-GCM decryption failed",
    );
  }
}

export function wechatPlatformKeyRing(creds: WechatPayV3Credentials): Map<string, KeyObject> {
  const ring = new Map<string, KeyObject>();
  const add = (serial: string | undefined, pem: string | undefined) => {
    if (!serial || !pem) return;
    ring.set(serial, loadPublicKey(pem));
  };
  add(creds.platformCertSerial, creds.platformCertPem);
  add(creds.platformCertSerialPrevious, creds.platformCertPemPrevious);
  add(creds.wechatpayPublicKeyId, creds.wechatpayPublicKey);
  if (creds.platformCertificatesJson) {
    for (const [serial, pem] of Object.entries(
      parsePlatformCertificatesJson(creds.platformCertificatesJson),
    )) {
      ring.set(serial, loadPublicKey(pem));
    }
  }
  return ring;
}

export function lookupWechatPlatformKey(ring: Map<string, KeyObject>, serial: string): KeyObject {
  const direct = ring.get(serial);
  if (direct) return direct;
  const lower = serial.toLowerCase();
  for (const [key, value] of ring) {
    if (key.toLowerCase() === lower) return value;
  }
  throw new EntitlementException(
    "PAYMENT_WEBHOOK_INVALID",
    "WeChat platform serial is not in the configured certificate key-ring",
  );
}

export function mapWechatTradeState(
  state: string,
): "succeeded" | "pending" | "failed" | "ignored" | "canceled" {
  switch (state) {
    case "SUCCESS":
      return "succeeded";
    case "NOTPAY":
    case "USERPAYING":
      return "pending";
    case "CLOSED":
    case "PAYERROR":
      return "failed";
    case "REVOKED":
      return "canceled";
    case "REFUND":
      return "ignored";
    default:
      return "pending";
  }
}

export function wechatCnyAmount(amountCents: number, currency: string): number {
  if (currency.toUpperCase() !== "CNY") {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "wechat_pay_v3 only accepts CNY amounts from the order snapshot",
    );
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "wechat_pay_v3 amount must be a positive integer minor unit",
    );
  }
  return amountCents;
}
