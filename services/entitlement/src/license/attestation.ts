/**
 * 跨区权益断言（Entitlement Attestation）—— FR-GEO-002 / FR-GEO-003。
 * 规范：DoerFlow spec/GEO_PORTABILITY.md §2
 *
 * 用途：全球站向大陆分站**单向**同步权益，使"海外购买的会员在境内可用"，
 * 同时避免把订单、支付凭证、链上标识带进境内库。
 *
 * 本文件只定义**契约与守卫**。签发 / 续签 / 撤销服务属 P4，尚未实现。
 * 密码学复用 ./ed25519.ts 与 ./canonical-json.ts —— 不新造签名方案。
 */

import { canonicalize } from "./canonical-json";
import { loadPublicKey } from "./ed25519";
import { verify } from "node:crypto";

export const ATTESTATION_KIND = "entitlement_attestation" as const;
export const ATTESTATION_VERSION = 1 as const;

/** 断言允许的时钟偏移（秒）。超出按无效处理。 */
export const ATTESTATION_CLOCK_SKEW_SECONDS = 300;

/** 单张断言建议 TTL 上限（天）。短 TTL + 续签使退款后境内快速失效。 */
export const ATTESTATION_MAX_TTL_DAYS = 7;

export interface AttestationFeature {
  code: string;
  type: "bool" | "quota";
  value: boolean | number;
}

export interface AttestationQuota {
  code: string;
  limit: number;
  mode: "counter" | "gauge";
}

export interface EntitlementAttestationPayload {
  v: typeof ATTESTATION_VERSION;
  kind: typeof ATTESTATION_KIND;
  /** 全球 Logto `sub`。大陆站联邦同一身份。 */
  subject: string;
  productCode: string;
  plan: string;
  features: AttestationFeature[];
  quotas: AttestationQuota[];
  validFrom: string;
  validUntil: string;
  issuedAt: string;
  issuerRegion: "global";
  keyId: string;
}

export interface SignedEntitlementAttestation {
  payload: EntitlementAttestationPayload;
  /** Base64url Ed25519 签名，覆盖 payload 的 canonical JSON。 */
  signature: string;
}

/**
 * 断言中**禁止**出现的字段（FR-GEO-003）。
 *
 * 这不是风格偏好。一旦断言携带 `txHash` / `orderId` / `providerId`，
 * 境内库就会存有加密支付凭证，跨区可携带性的整个合规前提随之失效。
 * 因此校验采用严格模式：遇到未知字段直接拒绝，而不是忽略。
 */
export const ATTESTATION_FORBIDDEN_FIELDS: readonly string[] = [
  "orderId",
  "orderRef",
  // subscriptions/grants 确实带 source/sourceRef（source="order" 时 sourceRef 即 orders.id）。
  // 投影为断言时必须剥离：境内库不需要、也不应持有境外订单引用。
  "source",
  "sourceRef",
  "providerId",
  "provider",
  "txHash",
  "transactionHash",
  "walletAddress",
  "payerAddress",
  "amountPaid",
  "amountMinor",
  "currency",
  "paymentAttemptId",
  "chargeId",
  "ledgerOpId",
];

const ATTESTATION_ALLOWED_FIELDS: readonly string[] = [
  "v",
  "kind",
  "subject",
  "productCode",
  "plan",
  "features",
  "quotas",
  "validFrom",
  "validUntil",
  "issuedAt",
  "issuerRegion",
  "keyId",
];

export type AttestationRejectCode =
  | "ATTESTATION_MALFORMED"
  | "ATTESTATION_FORBIDDEN_FIELD"
  | "ATTESTATION_UNKNOWN_FIELD"
  | "ATTESTATION_UNKNOWN_KEY"
  | "ATTESTATION_INVALID_SIGNATURE"
  | "ATTESTATION_EXPIRED"
  | "ATTESTATION_NOT_YET_VALID"
  | "ATTESTATION_TTL_TOO_LONG";

export type AttestationValidation =
  | { ok: true }
  | { ok: false; code: AttestationRejectCode; message: string };

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/**
 * 严格形状校验。**先于**验签调用，用于拒绝携带支付字段的断言。
 */
export function validateAttestationShape(payload: unknown): AttestationValidation {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "ATTESTATION_MALFORMED", message: "Payload must be an object" };
  }
  const obj = payload as Record<string, unknown>;

  for (const forbidden of ATTESTATION_FORBIDDEN_FIELDS) {
    if (forbidden in obj) {
      return {
        ok: false,
        code: "ATTESTATION_FORBIDDEN_FIELD",
        message: `Attestation must not carry payment field "${forbidden}"`,
      };
    }
  }
  for (const key of Object.keys(obj)) {
    if (!ATTESTATION_ALLOWED_FIELDS.includes(key)) {
      return {
        ok: false,
        code: "ATTESTATION_UNKNOWN_FIELD",
        message: `Unknown attestation field "${key}"; strict mode rejects unknown fields`,
      };
    }
  }

  if (obj.v !== ATTESTATION_VERSION || obj.kind !== ATTESTATION_KIND) {
    return { ok: false, code: "ATTESTATION_MALFORMED", message: "Unsupported v/kind" };
  }
  if (obj.issuerRegion !== "global") {
    return {
      ok: false,
      code: "ATTESTATION_MALFORMED",
      message: "Only global-issued attestations are accepted (sync is one-way)",
    };
  }
  for (const field of ["subject", "productCode", "plan", "keyId"]) {
    if (typeof obj[field] !== "string" || !(obj[field] as string).trim()) {
      return { ok: false, code: "ATTESTATION_MALFORMED", message: `Missing ${field}` };
    }
  }
  if (!Array.isArray(obj.features) || !Array.isArray(obj.quotas)) {
    return {
      ok: false,
      code: "ATTESTATION_MALFORMED",
      message: "features and quotas must be arrays",
    };
  }
  for (const field of ["validFrom", "validUntil", "issuedAt"]) {
    if (!isIsoDate(obj[field])) {
      return { ok: false, code: "ATTESTATION_MALFORMED", message: `Invalid ${field}` };
    }
  }

  const from = new Date(obj.validFrom as string).getTime();
  const until = new Date(obj.validUntil as string).getTime();
  if (until <= from) {
    return {
      ok: false,
      code: "ATTESTATION_MALFORMED",
      message: "validUntil must be after validFrom",
    };
  }
  if (until - from > ATTESTATION_MAX_TTL_DAYS * 24 * 60 * 60 * 1000) {
    return {
      ok: false,
      code: "ATTESTATION_TTL_TOO_LONG",
      message: `Attestation TTL must not exceed ${ATTESTATION_MAX_TTL_DAYS} days; renew instead`,
    };
  }
  return { ok: true };
}

export interface AttestationVerifyOptions {
  now?: Date;
  requireSubject?: string;
  requireProduct?: string;
}

/**
 * 验签 + 有效期校验。fail-closed —— 任何失败都视为无权益（402），
 * 不得降级为"暂时放行"。
 */
export function verifyEntitlementAttestation(
  attestation: SignedEntitlementAttestation,
  ring: Record<string, string>,
  opts?: AttestationVerifyOptions,
): AttestationValidation {
  const shape = validateAttestationShape(attestation?.payload);
  if (!shape.ok) return shape;

  const payload = attestation.payload;
  const pub = ring[payload.keyId];
  if (!pub) {
    return {
      ok: false,
      code: "ATTESTATION_UNKNOWN_KEY",
      message: `Unknown attestation keyId ${payload.keyId}`,
    };
  }

  let validSig = false;
  try {
    const key = loadPublicKey(pub);
    const bytes = Buffer.from(canonicalize(payload), "utf8");
    validSig = verify(null, bytes, key, Buffer.from(attestation.signature, "base64url"));
  } catch {
    return {
      ok: false,
      code: "ATTESTATION_INVALID_SIGNATURE",
      message: "Attestation signature verification failed",
    };
  }
  if (!validSig) {
    return {
      ok: false,
      code: "ATTESTATION_INVALID_SIGNATURE",
      message: "Tampered or invalid attestation signature",
    };
  }

  const now = (opts?.now ?? new Date()).getTime();
  const skew = ATTESTATION_CLOCK_SKEW_SECONDS * 1000;
  if (now + skew < new Date(payload.validFrom).getTime()) {
    return { ok: false, code: "ATTESTATION_NOT_YET_VALID", message: "Attestation not yet valid" };
  }
  if (now - skew >= new Date(payload.validUntil).getTime()) {
    return { ok: false, code: "ATTESTATION_EXPIRED", message: "Attestation expired" };
  }

  if (opts?.requireSubject && payload.subject !== opts.requireSubject) {
    return { ok: false, code: "ATTESTATION_MALFORMED", message: "Subject mismatch" };
  }
  if (opts?.requireProduct && payload.productCode !== opts.requireProduct) {
    return { ok: false, code: "ATTESTATION_MALFORMED", message: "Product mismatch" };
  }
  return { ok: true };
}
