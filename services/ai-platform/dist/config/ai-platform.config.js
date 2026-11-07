"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAiPlatformConfig = loadAiPlatformConfig;
exports.assertAiPlatformAuthConfig = assertAiPlatformAuthConfig;
exports.loadServiceCredentials = loadServiceCredentials;
exports.credentialsFromConfig = credentialsFromConfig;
const config_1 = require("@nestjs/config");
function flag(value, fallback) {
    if (value === undefined || value === "")
        return fallback;
    return value === "1" || value === "true" || value === "TRUE";
}
function integer(value, fallback) {
    if (value === undefined || value === "")
        return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function loadAiPlatformConfig(env = process.env) {
    const nodeEnv = env.NODE_ENV?.trim() || "development";
    const requested = env.AI_PLATFORM_AUTH_MODE?.trim();
    const authMode = requested === "legacy" ? "legacy" : "oidc";
    const serviceCredentials = loadServiceCredentials(env);
    const config = {
        port: integer(env.PORT, 13100),
        databaseUrl: env.AI_PLATFORM_DATABASE_URL?.trim() ||
            "postgres://ai_platform:CHANGE_ME@127.0.0.1:5433/ai_platform",
        migrationsRun: flag(env.AI_PLATFORM_MIGRATIONS_RUN, true),
        nodeEnv,
        serviceApiKey: env.AI_PLATFORM_SERVICE_API_KEY?.trim() ?? "",
        serviceCredentials,
        authMode,
        issuer: env.AI_PLATFORM_OIDC_ISSUER?.trim() || undefined,
        audience: env.AI_PLATFORM_OIDC_AUDIENCE?.trim() || undefined,
        jwksUri: env.AI_PLATFORM_JWKS_URI?.trim() || undefined,
        legacyJwtSecret: env.AI_PLATFORM_LEGACY_JWT_SECRET?.trim() ?? "",
        entitlementBaseUrl: env.ENTITLEMENT_BASE_URL?.trim() || env.AI_PLATFORM_ENTITLEMENT_BASE_URL?.trim() || "",
        entitlementServiceKey: env.ENTITLEMENT_SERVICE_API_KEY?.trim() || env.AI_PLATFORM_ENTITLEMENT_SERVICE_KEY?.trim() || "",
    };
    assertAiPlatformAuthConfig(config);
    return config;
}
/** Fail closed at startup. Called from config load and from main before listen. */
function assertAiPlatformAuthConfig(config) {
    if (config.nodeEnv === "production" && config.authMode === "legacy") {
        throw new Error("AI_PLATFORM_AUTH_MODE=legacy is not allowed when NODE_ENV=production");
    }
    if (config.authMode === "legacy" && !config.legacyJwtSecret) {
        throw new Error("AI_PLATFORM_LEGACY_JWT_SECRET is required when AI_PLATFORM_AUTH_MODE=legacy");
    }
    if (config.authMode === "oidc") {
        if (!config.issuer)
            throw new Error("AI_PLATFORM_OIDC_ISSUER is required when auth mode is oidc");
        if (!config.audience)
            throw new Error("AI_PLATFORM_OIDC_AUDIENCE is required when auth mode is oidc");
        if (!config.jwksUri) {
            throw new Error("AI_PLATFORM_JWKS_URI is required when auth mode is oidc. Use the jwks_uri from OpenID discovery (Logto via the auth gateway publishes {issuer}/jwks, for example http://localhost:3010/oidc/jwks). The platform does not guess this path.");
        }
    }
    if (config.nodeEnv === "production") {
        if (config.serviceCredentials.length === 0) {
            throw new Error("AI_PLATFORM_SERVICE_API_KEY or AI_PLATFORM_SERVICE_CREDENTIALS_JSON is required in production");
        }
        for (const credential of config.serviceCredentials) {
            if (credential.key.length < 16) {
                throw new Error("AI_PLATFORM_SERVICE_API_KEY must be at least 16 characters in production");
            }
            if (credential.productCodes.length === 0 && !credential.internal) {
                throw new Error("service credentials must set productCodes (AI_PLATFORM_SERVICE_PRODUCT_CODES or AI_PLATFORM_SERVICE_CREDENTIALS_JSON) or internal in production");
            }
        }
    }
}
/**
 * Single-key form: AI_PLATFORM_SERVICE_API_KEY + AI_PLATFORM_SERVICE_PRODUCT_CODES (comma-separated).
 * Multi-key form: AI_PLATFORM_SERVICE_CREDENTIALS_JSON, an array of { key, productCodes, internal? }.
 * Both may be set. The same key string must not appear twice.
 */
function loadServiceCredentials(env) {
    const credentials = [];
    const single = env.AI_PLATFORM_SERVICE_API_KEY?.trim() ?? "";
    if (single) {
        credentials.push({
            key: single,
            productCodes: splitCodes(env.AI_PLATFORM_SERVICE_PRODUCT_CODES),
            internal: flag(env.AI_PLATFORM_SERVICE_INTERNAL, false),
        });
    }
    const raw = env.AI_PLATFORM_SERVICE_CREDENTIALS_JSON?.trim();
    if (raw) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            throw new Error("AI_PLATFORM_SERVICE_CREDENTIALS_JSON is not valid JSON");
        }
        if (!Array.isArray(parsed)) {
            throw new Error("AI_PLATFORM_SERVICE_CREDENTIALS_JSON must be an array");
        }
        for (const item of parsed) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error("AI_PLATFORM_SERVICE_CREDENTIALS_JSON entries must be objects");
            }
            const row = item;
            if (typeof row.key !== "string" || row.key.trim() === "") {
                throw new Error("AI_PLATFORM_SERVICE_CREDENTIALS_JSON entry is missing key");
            }
            credentials.push({
                key: row.key.trim(),
                productCodes: codesFromJson(row.productCodes),
                internal: row.internal === true,
            });
        }
    }
    const seen = new Set();
    for (const credential of credentials) {
        if (seen.has(credential.key))
            throw new Error("duplicate service credential key");
        seen.add(credential.key);
    }
    return credentials;
}
function credentialsFromConfig(conf) {
    if (conf.serviceCredentials && conf.serviceCredentials.length > 0)
        return [...conf.serviceCredentials];
    if (conf.serviceApiKey)
        return [{ key: conf.serviceApiKey, productCodes: [], internal: false }];
    return [];
}
function splitCodes(value) {
    if (!value?.trim())
        return [];
    return dedupeCodes(value.split(",").map((part) => part.trim()));
}
function codesFromJson(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error("service credential productCodes must be an array of strings");
    }
    return dedupeCodes(value.map((item) => item.trim()));
}
function dedupeCodes(codes) {
    const seen = new Set();
    const out = [];
    for (const code of codes) {
        if (!code || seen.has(code))
            continue;
        seen.add(code);
        out.push(code);
    }
    return out;
}
exports.default = (0, config_1.registerAs)("aiPlatform", () => loadAiPlatformConfig());
