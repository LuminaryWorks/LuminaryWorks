import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (UTF-8). Length mismatch returns false without leaking. */
export function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    // Compare against self to keep timing roughly stable on length miss
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string, message: string | Buffer): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function hmacSha256Base64Url(secret: string, message: string | Buffer): string {
  return createHmac("sha256", secret).update(message).digest("base64url");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomClientId(prefix = "prt"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

/** Hash partner client secrets at rest (store only the hash). */
export function hashSecret(secret: string, pepper: string): string {
  return sha256Hex(`${pepper}:${secret}`);
}

export function verifySecretHash(secret: string, pepper: string, expectedHash: string): boolean {
  return safeEqualString(hashSecret(secret, pepper), expectedHash);
}
