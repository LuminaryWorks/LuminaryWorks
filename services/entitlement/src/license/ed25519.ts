import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { canonicalize } from "./canonical-json";

export interface LicensePayload {
  licenseId: string;
  kid: string;
  deploymentId: string;
  products: string[];
  features: Record<string, Record<string, boolean | number>>;
  seats?: Record<string, number>;
  issuedAt: string;
  expiresAt: string;
  offlineGraceDays: number;
  customerName?: string;
}

export interface SignedLicense {
  payload: LicensePayload;
  /** Base64url Ed25519 signature over canonical JSON of payload */
  signature: string;
}

export interface PublicKeyRing {
  [kid: string]: string; // SPKI PEM or raw base64url 32-byte public key
}

export function generateEd25519KeyPair(): {
  kid: string;
  privateKeyPem: string;
  publicKeyPem: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const kid = `ed25519-${Date.now().toString(36)}`;
  return {
    kid,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export function loadPrivateKey(pemOrBase64: string): KeyObject {
  const raw = pemOrBase64.includes("BEGIN") ? pemOrBase64 : Buffer.from(pemOrBase64, "base64");
  return createPrivateKey(
    typeof raw === "string"
      ? { key: raw, format: "pem" }
      : { key: raw, format: "der", type: "pkcs8" },
  );
}

export function loadPublicKey(pemOrBase64: string): KeyObject {
  if (pemOrBase64.includes("BEGIN")) {
    return createPublicKey({ key: pemOrBase64, format: "pem" });
  }
  // Accept raw 32-byte Ed25519 public key (base64 or base64url)
  const normalized = pemOrBase64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const der = Buffer.concat([
    // SPKI prefix for Ed25519
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(normalized + pad, "base64"),
  ]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

export function signLicensePayload(payload: LicensePayload, privateKeyPem: string): SignedLicense {
  const key = loadPrivateKey(privateKeyPem);
  const bytes = Buffer.from(canonicalize(payload), "utf8");
  const sig = sign(null, bytes, key);
  return { payload, signature: Buffer.from(sig).toString("base64url") };
}

export type LicenseVerifyFailure = "ENTITLEMENT_LICENSE_INVALID" | "ENTITLEMENT_LICENSE_EXPIRED";

export interface LicenseVerifyOk {
  ok: true;
  payload: LicensePayload;
  withinGrace: boolean;
}

export interface LicenseVerifyErr {
  ok: false;
  code: LicenseVerifyFailure;
  message: string;
}

export function verifySignedLicense(
  license: SignedLicense,
  ring: PublicKeyRing,
  opts?: { now?: Date; requireProduct?: string; requireFeature?: string },
): LicenseVerifyOk | LicenseVerifyErr {
  const { payload, signature } = license;
  if (!payload?.kid || !payload.licenseId || !payload.deploymentId) {
    return { ok: false, code: "ENTITLEMENT_LICENSE_INVALID", message: "Malformed license payload" };
  }
  const pub = ring[payload.kid];
  if (!pub) {
    return {
      ok: false,
      code: "ENTITLEMENT_LICENSE_INVALID",
      message: `Unknown kid ${payload.kid}`,
    };
  }

  let validSig = false;
  try {
    const key = loadPublicKey(pub);
    const bytes = Buffer.from(canonicalize(payload), "utf8");
    const sig = Buffer.from(signature, "base64url");
    validSig = verify(null, bytes, key, sig);
  } catch {
    return {
      ok: false,
      code: "ENTITLEMENT_LICENSE_INVALID",
      message: "Signature verification failed",
    };
  }
  if (!validSig) {
    return {
      ok: false,
      code: "ENTITLEMENT_LICENSE_INVALID",
      message: "Tampered or invalid signature",
    };
  }

  const now = opts?.now ?? new Date();
  const expiresAt = new Date(payload.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return { ok: false, code: "ENTITLEMENT_LICENSE_INVALID", message: "Invalid expiresAt" };
  }
  const graceMs = Math.max(0, payload.offlineGraceDays ?? 0) * 24 * 60 * 60 * 1000;
  const hardExpiry = new Date(expiresAt.getTime() + graceMs);
  if (now >= hardExpiry) {
    return {
      ok: false,
      code: "ENTITLEMENT_LICENSE_EXPIRED",
      message: "License expired (including offline grace)",
    };
  }
  const withinGrace = now >= expiresAt && now < hardExpiry;

  if (opts?.requireProduct && !payload.products.includes(opts.requireProduct)) {
    return {
      ok: false,
      code: "ENTITLEMENT_LICENSE_INVALID",
      message: `Product ${opts.requireProduct} not in license`,
    };
  }
  if (opts?.requireProduct && opts.requireFeature) {
    const feats = payload.features?.[opts.requireProduct] ?? {};
    const v = feats[opts.requireFeature];
    if (v !== true && !(typeof v === "number" && v > 0)) {
      return {
        ok: false,
        code: "ENTITLEMENT_LICENSE_INVALID",
        message: `Feature ${opts.requireFeature} not granted`,
      };
    }
  }

  return { ok: true, payload, withinGrace };
}

/** Parse env JSON public-key ring; never accepts private keys. */
export function parsePublicKeyRing(raw: string | undefined): PublicKeyRing {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ENTITLEMENT_LICENSE_PUBLIC_KEYS must be a JSON object of kid→publicKey");
  }
  const ring: PublicKeyRing = {};
  for (const [kid, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof val !== "string" || !val.trim()) {
      throw new Error(`Invalid public key for kid ${kid}`);
    }
    if (val.includes("PRIVATE")) {
      throw new Error("Private keys must not be placed in ENTITLEMENT_LICENSE_PUBLIC_KEYS");
    }
    ring[kid] = val;
  }
  return ring;
}
