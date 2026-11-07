import { encryptSecret } from "@luminaryworks/ai-client";

export const ENTITLEMENT_CACHE_TTL_MS = 60_000;

export type IngressKind = "open" | "product" | "public-disabled" | "public-unimplemented";

/** PUBLIC_API_ENABLED defaults to false. Read on each request so it can be toggled without a restart. */
export function readPublicApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
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

/** Production business routes refuse request-body secrets. POST /v1/providers/test opts in. */
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
