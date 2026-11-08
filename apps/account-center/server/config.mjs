/**
 * Runtime browser config for the Account Center.
 * Never put client secrets, service keys, or provider credentials here.
 */

const SECRET_KEY =
  /(secret|password|passwd|token|api[-_]?key|private[-_]?key|credential|pepper|master[-_]?key)/i;

const FORBIDDEN_OUTPUT_KEYS = new Set([
  "clientSecret",
  "client_secret",
  "serviceApiKey",
  "serviceKey",
]);

export function optionalUrl(value, label) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must be http(s)`);
  }
  return trimmed.replace(/\/$/, "");
}

export function requiredUrl(value, label) {
  const url = optionalUrl(value, label);
  if (!url) throw new Error(`${label} is required`);
  return url;
}

function rejectSecretDump(record, label) {
  for (const [key, value] of Object.entries(record)) {
    if (FORBIDDEN_OUTPUT_KEYS.has(key)) {
      throw new Error(`${label} must not include ${key}`);
    }
    if (SECRET_KEY.test(key) && String(value ?? "").trim()) {
      throw new Error(`${label} must not include secret-like key ${key}`);
    }
  }
}

export function parseApps(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("ACCOUNT_CENTER_APPS_JSON must be JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("ACCOUNT_CENTER_APPS_JSON must be an array");
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`apps[${index}] must be an object`);
    }
    const code = String(item.code ?? "").trim();
    const name = String(item.name ?? "").trim();
    const url = optionalUrl(item.url, `apps[${index}].url`);
    const description = String(item.description ?? "").trim();
    if (!code || !name || !url) {
      throw new Error(`apps[${index}] needs code, name, and url`);
    }
    return { code, name, url, description };
  });
}

export function buildRuntimeConfig(env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("ACCOUNT_CENTER_")) continue;
    if (SECRET_KEY.test(key) && String(value ?? "").trim()) {
      throw new Error(
        `Account Center env must not include secret-like key ${key}`,
      );
    }
  }
  const publicOrigin = optionalUrl(
    env.ACCOUNT_CENTER_PUBLIC_URL || env.ACCOUNT_CENTER_SPA_ORIGIN,
    "ACCOUNT_CENTER_PUBLIC_URL",
  );
  const issuer = requiredUrl(
    env.ACCOUNT_CENTER_IDP_ISSUER || env.IDP_ISSUER,
    "ACCOUNT_CENTER_IDP_ISSUER",
  );
  const clientId = String(
    env.ACCOUNT_CENTER_IDP_CLIENT_ID || env.IDP_CLIENT_ID || "",
  ).trim();
  const audience = String(
    env.ACCOUNT_CENTER_IDP_AUDIENCE ||
      env.AI_PLATFORM_OIDC_AUDIENCE ||
      "https://ai.luminaryworks.dev",
  ).trim();
  const aiPlatformBaseUrl = optionalUrl(
    env.ACCOUNT_CENTER_AI_BASE_URL || env.AI_PLATFORM_PUBLIC_URL,
    "ACCOUNT_CENTER_AI_BASE_URL",
  );
  const entitlementBaseUrl = optionalUrl(
    env.ACCOUNT_CENTER_ENTITLEMENT_BASE_URL || env.ENTITLEMENT_PUBLIC_URL,
    "ACCOUNT_CENTER_ENTITLEMENT_BASE_URL",
  );
  const experienceApiBase = optionalUrl(
    env.ACCOUNT_CENTER_AUTH_EXPERIENCE_URL ||
      env.AUTH_GATEWAY_PUBLIC_URL ||
      publicOrigin,
    "ACCOUNT_CENTER_AUTH_EXPERIENCE_URL",
  );
  const redirectUri =
    optionalUrl(
      env.ACCOUNT_CENTER_REDIRECT_URI,
      "ACCOUNT_CENTER_REDIRECT_URI",
    ) || (publicOrigin ? `${publicOrigin}/auth/callback` : "");
  const postLogoutRedirectUri =
    optionalUrl(
      env.ACCOUNT_CENTER_POST_LOGOUT_URI,
      "ACCOUNT_CENTER_POST_LOGOUT_URI",
    ) || (publicOrigin ? `${publicOrigin}/` : "");
  const issuerOrigin = issuer.replace(/\/oidc\/?$/, "");
  const accountUrl =
    optionalUrl(
      env.ACCOUNT_CENTER_IDP_ACCOUNT_URL,
      "ACCOUNT_CENTER_IDP_ACCOUNT_URL",
    ) || issuerOrigin;
  const securityUrl =
    optionalUrl(
      env.ACCOUNT_CENTER_IDP_SECURITY_URL,
      "ACCOUNT_CENTER_IDP_SECURITY_URL",
    ) || accountUrl;

  const config = {
    issuer,
    clientId,
    audience,
    aiPlatformBaseUrl,
    entitlementBaseUrl,
    experienceApiBase,
    redirectUri,
    postLogoutRedirectUri,
    scopes: String(
      env.ACCOUNT_CENTER_IDP_SCOPES || "openid profile email offline_access",
    ).trim(),
    iamProvider: String(
      env.ACCOUNT_CENTER_IAM_PROVIDER || env.IAM_PROVIDER || "logto",
    ).trim(),
    accountUrl,
    securityUrl,
    apps: parseApps(env.ACCOUNT_CENTER_APPS_JSON),
  };
  rejectSecretDump(config, "runtime config");
  for (const app of config.apps) rejectSecretDump(app, "runtime config.apps");
  return config;
}

export function buildHealthPayload() {
  return { status: "ok", service: "luminary-account-center" };
}

export function buildVersionPayload(env = process.env) {
  const gitSha = String(env.ACCOUNT_CENTER_GIT_SHA || "").trim();
  return {
    service: "luminary-account-center",
    version: "0.1.0",
    apiVersion: "v1",
    schemaVersion: "1",
    gitSha: gitSha || "unknown",
  };
}

export function evaluateReadiness({ distExists, configError }) {
  if (!distExists) {
    return {
      statusCode: 503,
      payload: {
        status: "not_ready",
        service: "luminary-account-center",
        failed: ["spa_dist"],
      },
    };
  }
  if (configError) {
    return {
      statusCode: 503,
      payload: {
        status: "not_ready",
        service: "luminary-account-center",
        failed: ["runtime_config"],
        detail: configError,
      },
    };
  }
  return {
    statusCode: 200,
    payload: { status: "ready", service: "luminary-account-center" },
  };
}
