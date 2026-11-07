"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENTITLEMENT_CACHE_TTL_MS = void 0;
exports.readPublicApiEnabled = readPublicApiEnabled;
exports.readWalletEnforce = readWalletEnforce;
exports.resolveIngress = resolveIngress;
exports.isByokPath = isByokPath;
exports.ephemeralSecretAllowed = ephemeralSecretAllowed;
exports.entitlementCacheKey = entitlementCacheKey;
exports.vaultKeyUsable = vaultKeyUsable;
exports.isProductionEnv = isProductionEnv;
const ai_client_1 = require("@luminaryworks/ai-client");
exports.ENTITLEMENT_CACHE_TTL_MS = 60_000;
/** PUBLIC_API_ENABLED defaults to false. Read on each request so it can be toggled without a restart. */
function readPublicApiEnabled(env = process.env) {
    const value = env.PUBLIC_API_ENABLED?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes";
}
/** Default off so lab traffic is not blocked before a rate card and grants exist. */
function readWalletEnforce(env = process.env) {
    const value = env.AI_PLATFORM_WALLET_ENFORCE?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes";
}
function resolveIngress(url, publicApiEnabled) {
    const path = (url.split("?")[0] ?? "/") || "/";
    if (path === "/ready" || path === "/v1/health")
        return "open";
    if (path === "/v1/public" || path.startsWith("/v1/public/")) {
        return publicApiEnabled ? "public-unimplemented" : "public-disabled";
    }
    return "product";
}
/**
 * Customer-held keys are BYOK and skip the entitlement feature check.
 * Platform-held deployment connections and luminary-managed routes are hosted.
 */
function isByokPath(input) {
    if (input.ephemeral)
        return true;
    if (input.providerType === "luminary-managed")
        return false;
    if (input.ownerKind === "deployment")
        return false;
    return (input.ownerKind === "user" ||
        input.ownerKind === "space" ||
        input.ownerKind === "organization");
}
/** Production business routes refuse request-body secrets. POST /v1/providers/test opts in. */
function ephemeralSecretAllowed(input) {
    if (!input.hasSecret)
        return true;
    if (!input.production)
        return true;
    return input.allowEphemeral;
}
/**
 * Spec cache key contains subjectId + feature. productCode is included because
 * entitlement features are scoped per product (spec §8.4 "含 subjectId + feature").
 */
function entitlementCacheKey(subjectId, feature, productCode) {
    return `${subjectId}+${feature}+${productCode}`;
}
function vaultKeyUsable(raw) {
    if (!raw?.trim())
        return false;
    try {
        const packed = (0, ai_client_1.encryptSecret)(raw, "ready");
        return packed.startsWith("v1:");
    }
    catch {
        return false;
    }
}
function isProductionEnv(env = process.env) {
    return (env.NODE_ENV ?? "").trim() === "production";
}
