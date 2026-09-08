import { createSign, createVerify, type KeyObject } from "node:crypto";
import { EntitlementException } from "../../common/errors";
import { loadPrivateKey, loadPublicKey } from "../../common/payment-credentials";

export const ALIPAY_CHARSET = "utf-8";
export const ALIPAY_SIGN_TYPE = "RSA2";
export const ALIPAY_FORMAT = "JSON";
export const ALIPAY_VERSION = "1.0";

export type AlipayTradeStatus =
  | "WAIT_BUYER_PAY"
  | "TRADE_SUCCESS"
  | "TRADE_FINISHED"
  | "TRADE_CLOSED";

export function yuanFromMinor(amountCents: number, currency: string): string {
  if (currency.toUpperCase() !== "CNY") {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "alipay_f2f only accepts CNY amounts from the order snapshot",
    );
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "alipay_f2f amount must be a positive integer minor unit",
    );
  }
  return (amountCents / 100).toFixed(2);
}

export function minorFromYuan(value: string, currency = "CNY"): number {
  if (currency.toUpperCase() !== "CNY") {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "alipay_f2f observed currency must be CNY",
    );
  }
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "alipay_f2f total_amount is not a strict decimal CNY amount",
    );
  }
  const [whole, frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatAlipayTimestamp(date: Date): string {
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
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function canonicalAlipayParams(
  params: Record<string, string>,
  exclude: ReadonlySet<string>,
): string {
  return Object.keys(params)
    .filter((key) => !exclude.has(key) && params[key] !== undefined && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

/** OpenAPI request sign: every field except `sign` (includes sign_type). */
export function signAlipayRequest(params: Record<string, string>, privateKeyPem: string): string {
  const canonical = canonicalAlipayParams(params, new Set(["sign"]));
  return rsa2Sign(canonical, loadPrivateKey(privateKeyPem));
}

/** Async notify verify: exclude sign and sign_type. */
export function verifyAlipayNotify(params: Record<string, string>, publicKeyPem: string): boolean {
  const sign = params.sign;
  if (!sign) return false;
  const canonical = canonicalAlipayParams(params, new Set(["sign", "sign_type"]));
  return rsa2Verify(canonical, sign, loadPublicKey(publicKeyPem));
}

export function rsa2Sign(canonical: string, key: KeyObject): string {
  const signer = createSign("RSA-SHA256");
  signer.update(canonical, "utf8");
  signer.end();
  return signer.sign(key, "base64");
}

export function rsa2Verify(canonical: string, signature: string, key: KeyObject): boolean {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(canonical, "utf8");
    verifier.end();
    return verifier.verify(key, signature, "base64");
  } catch {
    return false;
  }
}

export function parseAlipayNotifyBody(rawBody: Uint8Array): Record<string, string> {
  const text = Buffer.from(rawBody).toString("utf8");
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

export function mapAlipayTradeStatus(
  status: string,
): "pending" | "succeeded" | "failed" | "canceled" {
  if (status === "WAIT_BUYER_PAY") return "pending";
  if (status === "TRADE_SUCCESS" || status === "TRADE_FINISHED") return "succeeded";
  if (status === "TRADE_CLOSED") return "canceled";
  throw new EntitlementException(
    "PAYMENT_WEBHOOK_INVALID",
    `Unsupported Alipay trade_status ${status}`,
  );
}

export function alipaySuccess(code: string | undefined): boolean {
  return code === "10000";
}

export function extractAlipayResponseNode(raw: string, responseKey: string): string {
  const label = `"${responseKey}"`;
  const labelAt = raw.indexOf(label);
  if (labelAt < 0) {
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Alipay gateway response is missing the method node",
    );
  }
  const braceAt = raw.indexOf("{", labelAt + label.length);
  if (braceAt < 0) {
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Alipay gateway response node is malformed",
    );
  }
  return sliceJsonObject(raw, braceAt);
}

export function verifyAlipayGatewayResponse(
  raw: string,
  responseKey: string,
  sign: string,
  publicKeyPem: string,
): boolean {
  const content = extractAlipayResponseNode(raw, responseKey);
  return rsa2Verify(content, sign, loadPublicKey(publicKeyPem));
}

export function signedAlipayGatewayEnvelope(
  responseKey: string,
  payload: Record<string, unknown>,
  privateKeyPem: string,
): string {
  const node = JSON.stringify(payload);
  const sign = rsa2Sign(node, loadPrivateKey(privateKeyPem));
  return `{${JSON.stringify(responseKey)}:${node},"sign":${JSON.stringify(sign)}}`;
}

function sliceJsonObject(raw: string, start: number): string {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  throw new EntitlementException(
    "PAYMENT_PROVIDER_UNAVAILABLE",
    "Alipay gateway response node is truncated",
  );
}
