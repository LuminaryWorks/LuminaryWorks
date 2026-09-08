/**
 * Runtime browser config for the Control Console.
 * Never put client secrets, service keys, or payment credentials here.
 */

const SECRET_KEY =
  /(secret|password|passwd|token|api[-_]?key|private[-_]?key|credential|pepper|master[-_]?key)/i;

const FORBIDDEN_OUTPUT_KEYS = new Set([
  "clientSecret",
  "client_secret",
  "serviceApiKey",
  "serviceKey",
  "paymentConfigMasterKey",
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

export function buildRuntimeConfig(env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("CONTROL_CONSOLE_")) continue;
    if (SECRET_KEY.test(key) && String(value ?? "").trim()) {
      throw new Error(
        `Control Console env must not include secret-like key ${key}`,
      );
    }
  }
  const publicOrigin = optionalUrl(
    env.CONTROL_CONSOLE_PUBLIC_URL || env.CONTROL_CONSOLE_SPA_ORIGIN,
    "CONTROL_CONSOLE_PUBLIC_URL",
  );
  const issuer = requiredUrl(
    env.CONTROL_CONSOLE_IDP_ISSUER || env.IDP_ISSUER,
    "CONTROL_CONSOLE_IDP_ISSUER",
  );
  const clientId = String(
    env.CONTROL_CONSOLE_IDP_CLIENT_ID || env.IDP_CLIENT_ID || "",
  ).trim();
  const audience = String(
    env.CONTROL_CONSOLE_IDP_AUDIENCE ||
      env.ENTITLEMENT_OIDC_AUDIENCE ||
      "https://entitlement.luminaryworks.dev",
  ).trim();
  const entitlementBaseUrl = optionalUrl(
    env.CONTROL_CONSOLE_ENTITLEMENT_BASE_URL || env.ENTITLEMENT_PUBLIC_URL,
    "CONTROL_CONSOLE_ENTITLEMENT_BASE_URL",
  );
  const experienceApiBase = optionalUrl(
    env.CONTROL_CONSOLE_AUTH_EXPERIENCE_URL ||
      env.AUTH_GATEWAY_PUBLIC_URL ||
      publicOrigin,
    "CONTROL_CONSOLE_AUTH_EXPERIENCE_URL",
  );
  const redirectUri =
    optionalUrl(
      env.CONTROL_CONSOLE_REDIRECT_URI,
      "CONTROL_CONSOLE_REDIRECT_URI",
    ) || (publicOrigin ? `${publicOrigin}/auth/callback` : "");
  const postLogoutRedirectUri =
    optionalUrl(
      env.CONTROL_CONSOLE_POST_LOGOUT_URI,
      "CONTROL_CONSOLE_POST_LOGOUT_URI",
    ) || (publicOrigin ? `${publicOrigin}/` : "");

  const config = {
    issuer,
    clientId,
    audience,
    entitlementBaseUrl,
    experienceApiBase,
    redirectUri,
    postLogoutRedirectUri,
    scopes: String(
      env.CONTROL_CONSOLE_IDP_SCOPES ||
        "openid profile email offline_access entitlement:admin",
    ).trim(),
    iamProvider: String(
      env.CONTROL_CONSOLE_IAM_PROVIDER || env.IAM_PROVIDER || "logto",
    ).trim(),
    legalDocsUrl: optionalUrl(
      env.CONTROL_CONSOLE_LEGAL_DOCS_URL ||
        env.ENTITLEMENT_LEGAL_PUBLIC_BASE_URL,
      "CONTROL_CONSOLE_LEGAL_DOCS_URL",
    ),
    legalPolicyVersion: String(
      env.CONTROL_CONSOLE_LEGAL_POLICY_VERSION || "",
    ).trim(),
    capacity: {
      dorisPilotUrl: optionalUrl(
        env.CONTROL_CONSOLE_CAPACITY_DORIS_URL,
        "CONTROL_CONSOLE_CAPACITY_DORIS_URL",
      ),
      objectStorageUrl: optionalUrl(
        env.CONTROL_CONSOLE_CAPACITY_STORAGE_URL,
        "CONTROL_CONSOLE_CAPACITY_STORAGE_URL",
      ),
    },
  };
  rejectSecretDump(config, "runtime config");
  rejectSecretDump(config.capacity, "runtime config.capacity");
  return config;
}

export function buildHealthPayload() {
  return { status: "ok", service: "luminary-control-console" };
}

export function buildVersionPayload(env = process.env) {
  const gitSha = String(env.CONTROL_CONSOLE_GIT_SHA || "").trim();
  return {
    service: "luminary-control-console",
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
        service: "luminary-control-console",
        failed: ["spa_dist"],
      },
    };
  }
  if (configError) {
    return {
      statusCode: 503,
      payload: {
        status: "not_ready",
        service: "luminary-control-console",
        failed: ["runtime_config"],
        detail: configError,
      },
    };
  }
  return {
    statusCode: 200,
    payload: { status: "ready", service: "luminary-control-console" },
  };
}
