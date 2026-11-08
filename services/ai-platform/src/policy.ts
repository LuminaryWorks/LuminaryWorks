import { encryptSecret } from "@luminaryworks/ai-client";

export const ENTITLEMENT_CACHE_TTL_MS = 60_000;
export const PUBLIC_API_CACHE_TTL_MS = 2_000;

export type IngressKind = "open" | "product" | "public-disabled" | "public-unimplemented";

type PublicApiSnapshot = {
  hasRow: boolean;
  enabled: boolean;
  expiresAt: number;
};

let publicApiSnapshot: PublicApiSnapshot | null = null;
let publicApiRefresher: (() => Promise<void>) | null = null;

/**
 * Admin settings register this once. Ingress reads it per request; a fresh
 * snapshot skips the database. No row means the env value stays live.
 */
export function registerPublicApiRefresher(fn: () => Promise<void>): void {
  publicApiRefresher = fn;
}

export function notePublicApiSnapshot(hasRow: boolean, enabled: boolean, ttlMs = PUBLIC_API_CACHE_TTL_MS): void {
  publicApiSnapshot = { hasRow, enabled, expiresAt: Date.now() + ttlMs };
}

export function clearPublicApiSnapshot(): void {
  publicApiSnapshot = null;
}

export function publicApiSnapshotFresh(): boolean {
  return publicApiSnapshot != null && Date.now() < publicApiSnapshot.expiresAt;
}

export function publicApiSource(): "persisted" | "env" {
  if (publicApiSnapshot && Date.now() < publicApiSnapshot.expiresAt && publicApiSnapshot.hasRow) {
    return "persisted";
  }
  return "env";
}

export async function refreshPublicApiEnabled(): Promise<void> {
  if (!publicApiRefresher) return;
  try {
    await publicApiRefresher();
  } catch {
    // A missing settings table falls back to PUBLIC_API_ENABLED.
  }
}

/**
 * PUBLIC_API_ENABLED defaults to false. A persisted settings row overrides the
 * env value until it expires. Callers that pass an explicit env object (tests)
 * never see the process-wide snapshot.
 */
export function readPublicApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (
    env === process.env &&
    publicApiSnapshot &&
    Date.now() < publicApiSnapshot.expiresAt &&
    publicApiSnapshot.hasRow
  ) {
    return publicApiSnapshot.enabled;
  }
  const value = env.PUBLIC_API_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** Default off so lab traffic is not blocked before a rate card and grants exist. */
export function readWalletEnforce(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.AI_PLATFORM_WALLET_ENFORCE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function resolveIngress(url: string, publicApiEnabled: boolean): IngressKind {
  const path = (url.split("?")[0] ?? "/") || "/";
  if (path === "/ready" || path === "/v1/health") return "open";
  if (path === "/v1/public" || path.startsWith("/v1/public/")) {
    return publicApiEnabled ? "public-unimplemented" : "public-disabled";
  }
  return "product";
}

/**
 * Customer-held keys are BYOK and skip the entitlement feature check.
 * Platform-held deployment connections and luminary-managed routes are hosted.
 */
export function isByokPath(input: {
  ephemeral: boolean;
  providerType: string;
  ownerKind?: string | null;
}): boolean {
  if (input.ephemeral) return true;
  if (input.providerType === "luminary-managed") return false;
  if (input.ownerKind === "deployment") return false;
  return (
    input.ownerKind === "user" ||
    input.ownerKind === "space" ||
    input.ownerKind === "organization"
  );
}

/**
 * Lab/tests only. When true, provider base URLs may be loopback or RFC1918.
 * Production must leave this unset. http(s) and "no embedded credentials" still apply.
 */
export function allowPrivateBaseUrls(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Browser origins allowed to call the platform with an OIDC bearer token.
 * Comma-separated exact origins. Empty means no CORS headers (production default).
 * `*` is ignored so a wildcard cannot be combined with credentialed requests.
 */
export function readCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.AI_PLATFORM_CORS_ORIGINS ?? "";
  const seen = new Set<string>();
  const origins: string[] = [];
  for (const part of raw.split(",")) {
    const origin = part.trim();
    if (!origin || origin === "*" || seen.has(origin)) continue;
    seen.add(origin);
    origins.push(origin);
  }
  return origins;
}

/** Production business routes refuse request-body secrets. POST /v1/providers/test and /v1/providers/models opt in. */
export function ephemeralSecretAllowed(input: {
  production: boolean;
  allowEphemeral: boolean;
  hasSecret: boolean;
}): boolean {
  if (!input.hasSecret) return true;
  if (!input.production) return true;
  return input.allowEphemeral;
}

/**
 * Spec cache key contains subjectId + feature. productCode is included because
 * entitlement features are scoped per product (spec §8.4 "含 subjectId + feature").
 */
export function entitlementCacheKey(subjectId: string, feature: string, productCode: string): string {
  return `${subjectId}+${feature}+${productCode}`;
}

export function vaultKeyUsable(raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  try {
    const packed = encryptSecret(raw, "ready");
    return packed.startsWith("v1:");
  } catch {
    return false;
  }
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV ?? "").trim() === "production";
}

export interface ProductUsageLimit {
  rpm: number;
  dailyChargeMicro: number;
}

/**
 * Per-product hosted ceilings. Unset or blank means no extra limits.
 * A product key that is absent is unlimited. Invalid JSON throws.
 */
export function readProductLimits(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, ProductUsageLimit> {
  const raw = env.AI_PLATFORM_PRODUCT_LIMITS_JSON?.trim() ?? "";
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI_PLATFORM_PRODUCT_LIMITS_JSON must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI_PLATFORM_PRODUCT_LIMITS_JSON must be a JSON object");
  }
  const out: Record<string, ProductUsageLimit> = {};
  for (const [productCode, value] of Object.entries(parsed)) {
    const code = productCode.trim();
    if (!code || code !== productCode) {
      throw new Error(`Invalid productCode in AI_PLATFORM_PRODUCT_LIMITS_JSON: ${productCode}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`AI_PLATFORM_PRODUCT_LIMITS_JSON.${code} must be an object`);
    }
    const row = value as { rpm?: unknown; dailyChargeMicro?: unknown };
    out[code] = {
      rpm: nonNegativeInteger(row.rpm, `${code}.rpm`),
      dailyChargeMicro: nonNegativeInteger(row.dailyChargeMicro, `${code}.dailyChargeMicro`),
    };
  }
  return out;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
    throw new Error(`AI_PLATFORM_PRODUCT_LIMITS_JSON.${label} must be a non-negative integer`);
  }
  return value;
}
