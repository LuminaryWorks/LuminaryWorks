import { createSign, createVerify, type KeyObject } from "node:crypto";
import { EntitlementException } from "../../common/errors";
import { loadPrivateKey, loadPublicKey } from "../../common/payment-credentials";

export const UNIONPAY_VERSION = "5.1.0";
export const UNIONPAY_ENCODING = "UTF-8";
export const UNIONPAY_SIGN_METHOD_RSA = "01";
export const UNIONPAY_CNY = "156";

export function formatUnionpayTxnTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}

export function unionpayOrderId(attemptId: string): string {
  const compact = attemptId.replace(/[^A-Za-z0-9]/g, "");
  if (compact.length >= 8 && compact.length <= 40) return compact;
  if (compact.length > 0 && compact.length < 8) return compact.padStart(8, "0");
  throw new EntitlementException(
    "VALIDATION_ERROR",
    "unionpay_quickpass orderId (attempt id) must be 8–40 alphanumeric characters",
  );
}

export function unionpayAttemptIdFromOrderId(orderId: string): string {
  if (/^[0-9a-f]{32}$/i.test(orderId)) {
    return `${orderId.slice(0, 8)}-${orderId.slice(8, 12)}-${orderId.slice(12, 16)}-${orderId.slice(16, 20)}-${orderId.slice(20)}`;
  }
  return orderId.replace(/^0+/, "") || orderId;
}

export function canonicalUnionPayParams(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((key) => key !== "signature" && params[key] !== undefined && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

export function signUnionPayParams(params: Record<string, string>, privateKeyPem: string): string {
  const canonical = canonicalUnionPayParams(params);
  const signer = createSign("RSA-SHA256");
  signer.update(canonical, "utf8");
  return signer.sign(loadPrivateKey(privateKeyPem), "base64");
}

export function verifyUnionPayParams(
  params: Record<string, string>,
  publicKeyPem: string,
): boolean {
  const signature = params.signature ?? "";
  if (!signature) return false;
  const canonical = canonicalUnionPayParams(params);
  return verifyUnionPayCanonical(canonical, signature, loadPublicKey(publicKeyPem));
}

export function verifyUnionPayCanonical(
  canonical: string,
  signatureB64: string,
  publicKey: KeyObject,
): boolean {
  try {
    const decoded = Buffer.from(signatureB64.replace(/ /g, "+"), "base64");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(canonical, "utf8");
    return verifier.verify(publicKey, decoded);
  } catch {
    return false;
  }
}

export function parseUnionPayBody(rawBody: Uint8Array): Record<string, string> {
  const text = Buffer.from(rawBody).toString("utf8").trim();
  if (!text) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "UnionPay notify body is empty");
  }
  if (text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "UnionPay notify JSON is invalid");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "UnionPay notify JSON must be an object",
      );
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value == null) continue;
      out[key] = String(value);
    }
    return out;
  }
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

export function encodeUnionPayForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export function unionpayCnyFen(amountCents: number, currency: string): string {
  if (currency.toUpperCase() !== "CNY") {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "unionpay_quickpass only accepts CNY (currencyCode 156)",
    );
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "unionpay_quickpass amount must be a positive integer fen amount",
    );
  }
  return String(amountCents);
}

export function mapUnionpayRespCode(respCode: string): "succeeded" | "pending" | "failed" {
  if (respCode === "00") return "succeeded";
  if (respCode === "03" || respCode === "04" || respCode === "05") return "pending";
  return "failed";
}

export function composeUnionpayProviderRef(orderId: string, txnTime: string): string {
  return `${orderId}|${txnTime}`;
}

export function parseUnionpayProviderRef(providerRef: string): {
  orderId?: string;
  txnTime?: string;
  queryId?: string;
} {
  if (providerRef.includes("|")) {
    const [orderId, txnTime] = providerRef.split("|");
    return { orderId, txnTime };
  }
  if (/^\d{16,32}$/.test(providerRef)) return { queryId: providerRef };
  return { orderId: providerRef };
}
