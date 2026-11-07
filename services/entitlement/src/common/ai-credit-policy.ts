import type { PlanCode, SubjectKind } from "./constants";
import { getQuotaPack } from "./voice-packs";

export const AI_CREDIT_KINDS = ["topup", "subscription", "promo", "trial"] as const;
export type AiCreditKind = (typeof AI_CREDIT_KINDS)[number];

export type AiCreditCurrency = "USD" | "CNY";

/** Explicit per-SKU credit. Absent SKUs are not granted. */
export interface AiCreditSkuGrant {
  amountMicro: number;
  currency?: AiCreditCurrency;
  kind?: AiCreditKind;
  /** Undefined: derive from the order. Null: the grant does not expire. */
  expiresAt?: string | null;
  /** Undefined: restrict to fulfilled product codes. Null: unrestricted. */
  restrictTo?: { productCodes: string[]; capabilities?: string[] } | null;
}

export interface AiCreditPolicy {
  bySku: Record<string, AiCreditSkuGrant>;
  /** Null when AI_CREDIT_MICRO_PER_VOICE_SECOND is unset. */
  microPerVoiceSecond: number | null;
}

export interface AiCreditGrantPayload {
  orderId: string;
  walletOwner: { kind: "user" | "organization"; id: string };
  amountMicro: number;
  currency: AiCreditCurrency;
  expiresAt: string | null;
  restrictTo: { productCodes: string[]; capabilities?: string[] } | null;
  kind: AiCreditKind;
}

export interface AiCreditPlanInput {
  order: {
    id: string;
    subjectKind: SubjectKind;
    subjectId: string;
    currency: string;
    planCode: PlanCode | null;
    metadata?: Record<string, unknown> | null;
  };
  sku: string;
  products: Array<{ productCode: string; planCode: PlanCode | null; endsAt: Date | null }>;
  policy: AiCreditPolicy;
}

/** Boot and fulfillment share this parser. Invalid JSON fails the process, not one order. */
export function parseAiCreditPolicy(
  env: Record<string, string | undefined> = process.env,
): AiCreditPolicy {
  return {
    bySku: parseBySku(env.AI_CREDIT_GRANT_BY_SKU_JSON),
    microPerVoiceSecond: parseVoiceRate(env.AI_CREDIT_MICRO_PER_VOICE_SECOND),
  };
}

export function planAiCreditGrant(
  input: AiCreditPlanInput,
): { ok: true; payload: AiCreditGrantPayload } | { ok: false; reason: string } {
  const owner = walletOwner(input.order.subjectKind, input.order.subjectId);
  if (!owner) {
    const kind = input.order.subjectKind;
    const reason =
      kind === "USER" || kind === "ORGANIZATION"
        ? "subject id is empty"
        : `subject kind ${kind} has no AI wallet owner`;
    return { ok: false, reason };
  }

  const sku = input.sku.trim();
  const mapped = sku ? input.policy.bySku[sku] : undefined;
  const derivedKind = inferKind(input);
  const derivedExpires = expiresAtIso(input.products);
  const derivedRestrict = restrictToProducts(input.products);

  let amountMicro: number | null = mapped?.amountMicro ?? null;
  if (amountMicro == null) {
    const voice = voiceAmount(sku, input.policy.microPerVoiceSecond);
    if (voice && !voice.ok) return voice;
    if (voice?.ok) amountMicro = voice.amountMicro;
  }
  if (amountMicro == null) {
    return { ok: false, reason: `sku ${sku || "(empty)"} is not configured for AI credits` };
  }

  const currency = mapped?.currency ?? asCurrency(input.order.currency);
  if (!currency) {
    return { ok: false, reason: `order currency ${input.order.currency} is not USD or CNY` };
  }

  const restrictTo = mapped && "restrictTo" in mapped ? mapped.restrictTo! : derivedRestrict;
  if (restrictTo && restrictTo.productCodes.length === 0) {
    return { ok: false, reason: "restrictTo.productCodes is empty" };
  }

  return {
    ok: true,
    payload: {
      orderId: input.order.id,
      walletOwner: owner,
      amountMicro,
      currency,
      expiresAt: mapped && "expiresAt" in mapped ? mapped.expiresAt! : derivedExpires,
      restrictTo: restrictTo ?? null,
      kind: mapped?.kind ?? derivedKind,
    },
  };
}

function walletOwner(
  subjectKind: SubjectKind,
  subjectId: string,
): AiCreditGrantPayload["walletOwner"] | null {
  const id = subjectId.trim();
  if (!id) return null;
  if (subjectKind === "USER") return { kind: "user", id };
  if (subjectKind === "ORGANIZATION") return { kind: "organization", id };
  return null;
}

function inferKind(input: AiCreditPlanInput): AiCreditKind {
  if (input.order.metadata?.kind === "quota_pack") return "topup";
  const plans = input.products.map((item) => item.planCode);
  if (plans.length > 0 && plans.every((plan) => plan === "trial")) return "trial";
  if (input.order.planCode === "trial") return "trial";
  return "subscription";
}

function expiresAtIso(products: Array<{ endsAt: Date | null }>): string | null {
  let earliest: number | null = null;
  for (const product of products) {
    const ends = product.endsAt;
    if (!(ends instanceof Date) || Number.isNaN(ends.getTime())) continue;
    if (earliest == null || ends.getTime() < earliest) earliest = ends.getTime();
  }
  return earliest == null ? null : new Date(earliest).toISOString();
}

function restrictToProducts(
  products: Array<{ productCode: string }>,
): { productCodes: string[] } | null {
  const productCodes: string[] = [];
  for (const product of products) {
    const code = product.productCode.trim();
    if (code && !productCodes.includes(code)) productCodes.push(code);
  }
  return productCodes.length > 0 ? { productCodes } : null;
}

function voiceAmount(
  sku: string,
  microPerSecond: number | null,
): { ok: true; amountMicro: number } | { ok: false; reason: string } | null {
  if (microPerSecond == null) return null;
  const pack = getQuotaPack(sku);
  if (!pack || pack.seconds <= 0) return null;
  if (microPerSecond > Math.floor(Number.MAX_SAFE_INTEGER / pack.seconds)) {
    return { ok: false, reason: `voice-second conversion for ${sku} overflows` };
  }
  return { ok: true, amountMicro: pack.seconds * microPerSecond };
}

function parseBySku(raw: string | undefined): Record<string, AiCreditSkuGrant> {
  const text = raw?.trim() ?? "";
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI_CREDIT_GRANT_BY_SKU_JSON is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI_CREDIT_GRANT_BY_SKU_JSON must be a JSON object");
  }
  const bySku: Record<string, AiCreditSkuGrant> = {};
  for (const [sku, value] of Object.entries(parsed)) {
    if (!sku.trim()) throw new Error("AI_CREDIT_GRANT_BY_SKU_JSON contains an empty sku");
    bySku[sku] = parseEntry(sku, value);
  }
  return bySku;
}

function parseEntry(sku: string, value: unknown): AiCreditSkuGrant {
  if (typeof value === "number") {
    assertAmount(sku, value);
    return { amountMicro: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`AI_CREDIT_GRANT_BY_SKU_JSON.${sku} must be a positive integer or an object`);
  }
  const row = value as Record<string, unknown>;
  assertAmount(sku, row.amountMicro);
  const grant: AiCreditSkuGrant = { amountMicro: row.amountMicro as number };
  if (row.currency !== undefined) {
    const currency = asCurrency(row.currency);
    if (!currency) {
      throw new Error(`AI_CREDIT_GRANT_BY_SKU_JSON.${sku}.currency must be USD or CNY`);
    }
    grant.currency = currency;
  }
  if (row.kind !== undefined) {
    if (!isKind(row.kind)) {
      throw new Error(`AI_CREDIT_GRANT_BY_SKU_JSON.${sku}.kind is invalid`);
    }
    grant.kind = row.kind;
  }
  if ("expiresAt" in row) {
    grant.expiresAt = parseExpires(sku, row.expiresAt);
  }
  if ("restrictTo" in row) {
    grant.restrictTo = row.restrictTo === null ? null : parseRestrict(sku, row.restrictTo);
  }
  return grant;
}

function assertAmount(sku: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`AI_CREDIT_GRANT_BY_SKU_JSON.${sku} amountMicro must be a positive integer`);
  }
}

function parseExpires(sku: string, value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new Error(`AI_CREDIT_GRANT_BY_SKU_JSON.${sku}.expiresAt must be an ISO date or null`);
}

function parseRestrict(
  sku: string,
  value: unknown,
): { productCodes: string[]; capabilities?: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`AI_CREDIT_GRANT_BY_SKU_JSON.${sku}.restrictTo must be an object or null`);
  }
  const row = value as Record<string, unknown>;
  const productCodes = stringList(sku, "productCodes", row.productCodes);
  if (productCodes.length === 0) {
    throw new Error(`AI_CREDIT_GRANT_BY_SKU_JSON.${sku}.restrictTo.productCodes is empty`);
  }
  const restrict: { productCodes: string[]; capabilities?: string[] } = { productCodes };
  if (row.capabilities !== undefined) {
    const capabilities = stringList(sku, "capabilities", row.capabilities);
    if (capabilities.length > 0) restrict.capabilities = capabilities;
  }
  return restrict;
}

function stringList(sku: string, key: string, value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`AI_CREDIT_GRANT_BY_SKU_JSON.${sku}.restrictTo.${key} must be an array`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(
        `AI_CREDIT_GRANT_BY_SKU_JSON.${sku}.restrictTo.${key} must be non-empty strings`,
      );
    }
    const trimmed = item.trim();
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function parseVoiceRate(raw: string | undefined): number | null {
  const text = raw?.trim() ?? "";
  if (!text) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("AI_CREDIT_MICRO_PER_VOICE_SECOND must be a positive integer");
  }
  return value;
}

function asCurrency(value: unknown): AiCreditCurrency | null {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  if (currency === "USD" || currency === "CNY") return currency;
  return null;
}

function isKind(value: unknown): value is AiCreditKind {
  return AI_CREDIT_KINDS.some((kind) => kind === value);
}
