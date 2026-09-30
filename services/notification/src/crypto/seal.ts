import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

function keyFromPassphrase(passphrase: string): Buffer {
  return createHash("sha256").update(passphrase, "utf8").digest();
}

export function sealJson(payload: unknown, passphrase: string): string {
  if (!passphrase) throw new Error("NOTIFICATION_SECRET_KEY is required to seal credentials");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromPassphrase(passphrase), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function openJson<T>(sealed: string, passphrase: string): T {
  if (!passphrase) throw new Error("NOTIFICATION_SECRET_KEY is required to open credentials");
  const buf = Buffer.from(sealed, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyFromPassphrase(passphrase), iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(json) as T;
}

export function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
