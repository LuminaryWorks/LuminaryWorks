import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { EntitlementException } from "./errors";

export const PAYMENT_ENVELOPE_PREFIX = "lwpay1";
export const PAYMENT_CRYPTO_ALG = "aes-256-gcm";
export const PAYMENT_MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const AAD = Buffer.from("lw-payment-config-v1");

const CREDENTIAL_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_CREDENTIAL_KEYS = 48;
const MAX_CREDENTIAL_VALUE = 32_768;

export type GenericCredentials = Record<string, string>;

export function parsePaymentMasterKey(raw: string | undefined | null): Buffer {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "PAYMENT_CONFIG_MASTER_KEY is required to encrypt or decrypt provider credentials",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const fromB64 = Buffer.from(trimmed, "base64");
  if (fromB64.length === PAYMENT_MASTER_KEY_BYTES) {
    return fromB64;
  }
  throw new EntitlementException(
    "VALIDATION_ERROR",
    "PAYMENT_CONFIG_MASTER_KEY must be 32 bytes as hex (64 chars) or standard base64",
  );
}

export function fingerprintPaymentMasterKey(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function assertPaymentMasterKeyAvailable(input: {
  nodeEnv: string;
  masterKey: string | undefined | null;
  enabledProviderConfigs: number;
}): void {
  const production = input.nodeEnv === "production";
  if (!production) return;
  if (input.enabledProviderConfigs <= 0) return;
  if (input.masterKey?.trim()) {
    parsePaymentMasterKey(input.masterKey);
    return;
  }
  throw new EntitlementException(
    "VALIDATION_ERROR",
    "PAYMENT_CONFIG_MASTER_KEY is required in production when payment provider configs are enabled",
  );
}

export function encryptPaymentSecrets(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(PAYMENT_CRYPTO_ALG, masterKey, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const kid = fingerprintPaymentMasterKey(masterKey);
  return [
    PAYMENT_ENVELOPE_PREFIX,
    kid,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptPaymentSecrets(envelope: string, masterKey: Buffer): string {
  const parts = envelope.split(".");
  if (parts.length !== 5 || parts[0] !== PAYMENT_ENVELOPE_PREFIX) {
    throw new EntitlementException("VALIDATION_ERROR", "Payment credential envelope is malformed");
  }
  const [, kid, ivB64, ctB64, tagB64] = parts;
  const expectedKid = fingerprintPaymentMasterKey(masterKey);
  if (kid !== expectedKid) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "Payment credential envelope was encrypted with a different master key",
    );
  }
  try {
    const iv = Buffer.from(ivB64, "base64url");
    const ciphertext = Buffer.from(ctB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const decipher = createDecipheriv(PAYMENT_CRYPTO_ALG, masterKey, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "Payment credential envelope was encrypted with a different master key",
    );
  }
}

export function fingerprintCredentials(credentials: GenericCredentials): string {
  const canonical = JSON.stringify(
    Object.keys(credentials)
      .sort()
      .map((key) => [key, credentials[key]]),
  );
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function credentialLastFour(credentials: GenericCredentials): string {
  const preferred =
    credentials.appId ??
    credentials.merchantId ??
    credentials.clientId ??
    credentials.mchid ??
    Object.values(credentials)[0];
  if (!preferred || preferred.length < 4) return "****";
  return preferred.slice(-4);
}

export function assertGenericCredentials(value: unknown): GenericCredentials {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "Provider credentials must be a non-array object of string values",
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CREDENTIAL_KEYS) {
    throw new EntitlementException("VALIDATION_ERROR", "Provider credentials have too many keys");
  }
  const out: GenericCredentials = {};
  for (const [key, raw] of entries) {
    if (!CREDENTIAL_KEY.test(key)) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        `Invalid credential field name ${key}; use identifier-style keys`,
      );
    }
    if (typeof raw !== "string") {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        `Credential field ${key} must be a string; provider-specific objects are deferred to adapters`,
      );
    }
    if (raw.length === 0 || raw.length > MAX_CREDENTIAL_VALUE) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        `Credential field ${key} has an invalid length`,
      );
    }
    out[key] = raw;
  }
  return out;
}

const SECRET_KEY = /secret|password|private|pem|token|credential|key|cert/i;

export function redactPaymentSecrets<T>(value: T): T {
  return redactUnknown(value) as T;
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === "credentials" && nested && typeof nested === "object" && !Array.isArray(nested)) {
      const redacted: Record<string, string> = {};
      for (const nestedKey of Object.keys(nested as Record<string, unknown>)) {
        redacted[nestedKey] = "[redacted]";
      }
      out[key] = redacted;
      continue;
    }
    if (
      SECRET_KEY.test(key) ||
      key === "credentialsCiphertext" ||
      key === "previousCredentialsCiphertext"
    ) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = redactUnknown(nested);
  }
  return out;
}
