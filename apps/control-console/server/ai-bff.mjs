import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { buildRuntimeConfig } from "./config.mjs";

const jwksByIssuer = new Map();

const SECRET_FIELD =
  /^(secret|apiKey|api_key|ciphertext|authorization|x-service-key|serviceKey|password|token|masterKey)$/i;

/**
 * Operator BFF for AI Platform. The browser sends its OIDC access token.
 * AI_PLATFORM_INTERNAL_SERVICE_KEY stays on this server.
 */
export function registerAiBff(app, env) {
  const handler = async (req, reply) => {
    const result = await dispatchAiBff({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      env,
    });
    reply.code(result.status);
    reply.header("cache-control", "no-store");
    return result.body;
  };
  const routes = [
    ["GET", "/bff/ai/settings"],
    ["PUT", "/bff/ai/settings/public-api"],
    ["GET", "/bff/ai/wallets"],
    ["POST", "/bff/ai/wallets/grant"],
    ["POST", "/bff/ai/wallets/revoke"],
    ["GET", "/bff/ai/usage"],
    ["GET", "/bff/ai/rate-cards"],
    ["POST", "/bff/ai/rate-cards"],
    ["GET", "/bff/ai/connections"],
    ["POST", "/bff/ai/connections"],
    ["PATCH", "/bff/ai/connections/:uid"],
  ];
  for (const [method, url] of routes) {
    app.route({ method, url, handler });
  }
}

export async function dispatchAiBff({
  method,
  url,
  headers,
  body,
  bodyText,
  env,
}) {
  const verb = String(method || "GET").toUpperCase();
  const parsedUrl = new URL(url || "/", "http://localhost");
  const path = parsedUrl.pathname;
  const operator = await verifyOperator(headers, env);
  if (!operator.ok)
    return jsonError(operator.status, operator.code, operator.message);

  let payload = body;
  if ((payload === undefined || payload === null) && bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return jsonError(400, "VALIDATION_ERROR", "Request body must be JSON");
    }
  }

  const base = String(env.AI_PLATFORM_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const serviceKey = String(env.AI_PLATFORM_INTERNAL_SERVICE_KEY || "").trim();
  if (!base || !serviceKey) {
    return jsonError(
      503,
      "AI_PLATFORM_UNAVAILABLE",
      "AI platform is not configured",
    );
  }

  try {
    const upstream = await routeUpstream(verb, path, parsedUrl, payload);
    if (upstream.error) return upstream.error;
    const result = await callUpstream(
      base,
      serviceKey,
      operator.subject,
      upstream,
    );
    return {
      status: result.status,
      body: scrubValue(result.body, serviceKey),
    };
  } catch {
    return jsonError(
      503,
      "AI_PLATFORM_UNAVAILABLE",
      "AI platform is not reachable",
    );
  }
}

async function verifyOperator(headers, env) {
  const header = headerOf(headers, "authorization");
  const token = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";
  if (!token)
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Authentication required",
    };
  let runtime;
  try {
    runtime = buildRuntimeConfig(env);
  } catch (err) {
    return {
      ok: false,
      status: 503,
      code: "CONFIG_INVALID",
      message: err instanceof Error ? err.message : "runtime config is invalid",
    };
  }
  try {
    const jwks = jwksFor(runtime.issuer);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: runtime.issuer,
      audience: runtime.audience,
      algorithms: ["RS256", "ES256"],
    });
    const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!subject) {
      return {
        ok: false,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Authentication required",
      };
    }
    const scopes = scopesOf(payload);
    if (!scopes.includes("ai:admin") && !scopes.includes("entitlement:admin")) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN",
        message: "ai:admin or entitlement:admin is required",
      };
    }
    return { ok: true, subject, scopes };
  } catch {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Authentication required",
    };
  }
}

function routeUpstream(method, path, url, body) {
  if (method === "GET" && path === "/bff/ai/settings") {
    return { method: "GET", path: "/v1/internal/admin/settings" };
  }
  if (method === "PUT" && path === "/bff/ai/settings/public-api") {
    const row = objectOf(body);
    if (!row || typeof row.enabled !== "boolean") {
      return {
        error: jsonError(400, "VALIDATION_ERROR", "enabled must be a boolean"),
      };
    }
    const upstreamBody = { enabled: row.enabled };
    if (typeof row.reason === "string" && row.reason.trim())
      upstreamBody.reason = row.reason.trim();
    return {
      method: "PUT",
      path: "/v1/internal/admin/settings/public-api",
      body: upstreamBody,
    };
  }
  if (method === "GET" && path === "/bff/ai/wallets") {
    return { method: "GET", path: `/v1/internal/admin/wallets${url.search}` };
  }
  if (method === "POST" && path === "/bff/ai/wallets/grant") {
    const built = buildGrant(body);
    if (built.error) return built;
    return {
      method: "POST",
      path: "/v1/internal/credits/grant",
      body: built.body,
    };
  }
  if (method === "POST" && path === "/bff/ai/wallets/revoke") {
    const built = buildRevoke(body);
    if (built.error) return built;
    return {
      method: "POST",
      path: "/v1/internal/credits/revoke",
      body: built.body,
    };
  }
  if (method === "GET" && path === "/bff/ai/usage") {
    return { method: "GET", path: `/v1/internal/admin/usage${url.search}` };
  }
  if (method === "GET" && path === "/bff/ai/rate-cards") {
    return { method: "GET", path: "/v1/internal/admin/rate-cards" };
  }
  if (method === "POST" && path === "/bff/ai/rate-cards") {
    if (!objectOf(body))
      return {
        error: jsonError(
          400,
          "VALIDATION_ERROR",
          "Request body must be an object",
        ),
      };
    return { method: "POST", path: "/v1/internal/rate-cards", body };
  }
  if (method === "GET" && path === "/bff/ai/connections") {
    return { method: "GET", path: "/v1/internal/admin/connections" };
  }
  if (method === "POST" && path === "/bff/ai/connections") {
    const built = buildConnection(body);
    if (built.error) return built;
    return { method: "POST", path: "/v1/providers", body: built.body };
  }
  const match = path.match(/^\/bff\/ai\/connections\/([^/]+)$/);
  if (method === "PATCH" && match) {
    const built = buildConnectionPatch(body);
    if (built.error) return built;
    return {
      method: "PATCH",
      path: `/v1/providers/${encodeURIComponent(decodeURIComponent(match[1]))}`,
      body: built.body,
    };
  }
  return { error: jsonError(404, "NOT_FOUND", path) };
}

function buildGrant(body) {
  const row = objectOf(body);
  if (!row)
    return {
      error: jsonError(
        400,
        "VALIDATION_ERROR",
        "Request body must be an object",
      ),
    };
  const reason = requiredText(row.reason, "reason");
  if (reason.error) return reason;
  if (row.ownerKind !== "user" && row.ownerKind !== "organization") {
    return {
      error: jsonError(400, "VALIDATION_ERROR", "ownerKind is invalid"),
    };
  }
  const ownerId = requiredText(row.ownerId, "ownerId");
  if (ownerId.error) return ownerId;
  const amountMicro = positiveInt(row.amountMicro, "amountMicro");
  if (amountMicro.error) return amountMicro;
  const expiresAt = requiredText(row.expiresAt, "expiresAt");
  if (expiresAt.error) return expiresAt;
  if (Number.isNaN(Date.parse(expiresAt.value))) {
    return {
      error: jsonError(
        400,
        "VALIDATION_ERROR",
        "expiresAt must be an ISO date",
      ),
    };
  }
  const currency = row.currency === undefined ? "USD" : row.currency;
  if (currency !== "USD" && currency !== "CNY") {
    return { error: jsonError(400, "VALIDATION_ERROR", "currency is invalid") };
  }
  const upstream = {
    orderId: `admin:${randomUUID()}`,
    walletOwner: { kind: row.ownerKind, id: ownerId.value },
    amountMicro: amountMicro.value,
    currency,
    kind: "promo",
    expiresAt: expiresAt.value,
  };
  if (row.restrictTo !== undefined) upstream.restrictTo = row.restrictTo;
  return { body: upstream };
}

function buildRevoke(body) {
  const row = objectOf(body);
  if (!row)
    return {
      error: jsonError(
        400,
        "VALIDATION_ERROR",
        "Request body must be an object",
      ),
    };
  const reason = requiredText(row.reason, "reason");
  if (reason.error) return reason;
  const orderId = requiredText(row.orderId, "orderId");
  if (orderId.error) return orderId;
  const upstream = { orderId: orderId.value };
  if (row.amountMicro !== undefined) {
    const amount = nonNegativeInt(row.amountMicro, "amountMicro");
    if (amount.error) return amount;
    upstream.amountMicro = amount.value;
  }
  if (row.seal !== undefined) upstream.seal = Boolean(row.seal);
  return { body: upstream };
}

function buildConnection(body) {
  const row = objectOf(body);
  if (!row)
    return {
      error: jsonError(
        400,
        "VALIDATION_ERROR",
        "Request body must be an object",
      ),
    };
  const providerType = requiredText(row.providerType, "providerType");
  if (providerType.error) return providerType;
  const displayName = requiredText(row.displayName, "displayName");
  if (displayName.error) return displayName;
  const model = requiredText(row.model, "model");
  if (model.error) return model;
  if (typeof row.secret !== "string" || row.secret.trim() === "") {
    return { error: jsonError(400, "VALIDATION_ERROR", "secret is required") };
  }
  const upstream = {
    ownerKind: "deployment",
    ownerUid:
      typeof row.ownerUid === "string" && row.ownerUid.trim()
        ? row.ownerUid.trim()
        : "deployment",
    providerType: providerType.value,
    displayName: displayName.value,
    model: model.value,
    secret: row.secret,
    enabled: row.enabled === undefined ? true : Boolean(row.enabled),
  };
  if (typeof row.uid === "string" && row.uid.trim())
    upstream.uid = row.uid.trim();
  if (typeof row.baseUrl === "string") upstream.baseUrl = row.baseUrl.trim();
  if (typeof row.purpose === "string" && row.purpose.trim())
    upstream.purpose = row.purpose.trim();
  return { body: upstream };
}

function buildConnectionPatch(body) {
  const row = objectOf(body);
  if (!row)
    return {
      error: jsonError(
        400,
        "VALIDATION_ERROR",
        "Request body must be an object",
      ),
    };
  const upstream = {};
  if (typeof row.enabled === "boolean") upstream.enabled = row.enabled;
  if (typeof row.displayName === "string" && row.displayName.trim())
    upstream.displayName = row.displayName.trim();
  if (typeof row.model === "string" && row.model.trim())
    upstream.model = row.model.trim();
  if (row.baseUrl === null) upstream.baseUrl = null;
  if (typeof row.baseUrl === "string") upstream.baseUrl = row.baseUrl.trim();
  if (typeof row.secret === "string" && row.secret.trim())
    upstream.secret = row.secret;
  if (typeof row.purpose === "string") upstream.purpose = row.purpose.trim();
  if (Object.keys(upstream).length === 0) {
    return {
      error: jsonError(
        400,
        "VALIDATION_ERROR",
        "no connection fields to update",
      ),
    };
  }
  return { body: upstream };
}

async function callUpstream(base, serviceKey, subject, upstream) {
  const headers = {
    Accept: "application/json",
    "X-Service-Key": serviceKey,
    "X-Service-Subject": subject,
  };
  let body;
  if (upstream.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(upstream.body);
  }
  const res = await fetch(`${base}${upstream.path}`, {
    method: upstream.method,
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        error: {
          code: "REQUEST_FAILED",
          message: "Upstream returned a non-JSON body",
        },
      };
    }
  }
  return { status: res.status, body: parsed };
}

function jwksFor(issuer) {
  const existing = jwksByIssuer.get(issuer);
  if (existing) return existing;
  const url = new URL("jwks", issuer.endsWith("/") ? issuer : `${issuer}/`);
  const set = createRemoteJWKSet(url);
  jwksByIssuer.set(issuer, set);
  return set;
}

function scopesOf(payload) {
  if (typeof payload.scope === "string")
    return payload.scope.split(/\s+/).filter(Boolean);
  if (Array.isArray(payload.scopes)) return payload.scopes.map(String);
  return [];
}

function headerOf(headers, name) {
  if (!headers) return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function objectOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function requiredText(value, key) {
  if (typeof value !== "string" || value.trim() === "") {
    return { error: jsonError(400, "VALIDATION_ERROR", `${key} is required`) };
  }
  return { value: value.trim() };
}

function positiveInt(value, key) {
  const parsed = nonNegativeInt(value, key);
  if (parsed.error) return parsed;
  if (parsed.value <= 0)
    return {
      error: jsonError(400, "VALIDATION_ERROR", `${key} must be positive`),
    };
  return parsed;
}

function nonNegativeInt(value, key) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return {
      error: jsonError(
        400,
        "VALIDATION_ERROR",
        `${key} must be a non-negative integer`,
      ),
    };
  }
  return { value };
}

function jsonError(status, code, message) {
  return { status, body: { error: { code, message } } };
}

function scrubValue(value, secret) {
  if (Array.isArray(value))
    return value.map((item) => scrubValue(item, secret));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_FIELD.test(key)) continue;
      out[key] = scrubValue(nested, secret);
    }
    return out;
  }
  if (typeof value === "string" && secret && value.includes(secret)) {
    return value.split(secret).join("[redacted]");
  }
  return value;
}
