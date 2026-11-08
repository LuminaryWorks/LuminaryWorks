import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const INTERNAL = "credential-internal-admin-01";
const PRODUCT = "credential-product-blockyedu";
const ISSUER = "https://id.example.test/oidc";
const AUDIENCE = "https://ai.luminaryworks.dev";
const CONTAINER = `lw-ai-admin-${process.pid}`;

let app;
let fastify;
let jwksServer;
let privateKey;

describe("ai platform operator admin", { concurrency: 1 }, () => {
  before(async () => {
    await docker(["rm", "-f", CONTAINER]).catch(() => {});
    await docker([
      "run", "-d", "--name", CONTAINER,
      "-e", "POSTGRES_USER=ai",
      "-e", "POSTGRES_PASSWORD=ai_platform_test",
      "-e", "POSTGRES_DB=ai_platform",
      "-p", "127.0.0.1::5432",
      "postgres:16-alpine",
    ]);
    const mapped = await waitForPostgres();
    const port = Number(mapped.split(":").pop());
    if (!port) throw new Error(`could not parse postgres port from ${mapped}`);

    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = "admin-test";
    jwk.alg = "RS256";
    jwk.use = "sig";
    jwksServer = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));

    process.env.NODE_ENV = "production";
    process.env.AI_PLATFORM_DATABASE_URL = `postgres://ai:ai_platform_test@127.0.0.1:${port}/ai_platform`;
    process.env.AI_PLATFORM_MIGRATIONS_RUN = "true";
    process.env.AI_PLATFORM_SERVICE_API_KEY = INTERNAL;
    process.env.AI_PLATFORM_SERVICE_INTERNAL = "true";
    process.env.AI_PLATFORM_SERVICE_PRODUCT_CODES = "luminaryworks";
    process.env.AI_PLATFORM_SERVICE_CREDENTIALS_JSON = JSON.stringify([
      { key: PRODUCT, productCodes: ["blockyedu"] },
    ]);
    process.env.AI_PLATFORM_AUTH_MODE = "oidc";
    process.env.AI_PLATFORM_OIDC_ISSUER = ISSUER;
    process.env.AI_PLATFORM_OIDC_AUDIENCE = AUDIENCE;
    process.env.AI_PLATFORM_JWKS_URI = `http://127.0.0.1:${jwksServer.address().port}/jwks`;
    process.env.AI_VAULT_MASTER_KEY = "ab".repeat(32);
    process.env.PUBLIC_API_ENABLED = "false";
    process.env.AI_PLATFORM_WALLET_ENFORCE = "false";
    delete process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS;
    process.env.ENTITLEMENT_BASE_URL = "http://127.0.0.1:9";
    process.env.ENTITLEMENT_SERVICE_API_KEY = "ent-service-key-012345";
    process.env.AI_PRODUCT_POLICIES_JSON = "[]";

    const { NestFactory } = await import("@nestjs/core");
    const { FastifyAdapter } = await import("@nestjs/platform-fastify");
    const { AppModule } = await import("../dist/app.module.js");
    app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
    await app.init();
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();
  });

  after(async () => {
    if (app) await app.close();
    if (jwksServer) await new Promise((resolve) => jwksServer.close(resolve));
    await docker(["rm", "-f", CONTAINER]).catch(() => {});
  });

  test("anonymous and non-internal callers cannot use operator routes", async () => {
    const missing = await hit("GET", "/v1/internal/admin/settings");
    assert.equal(missing.status, 401);
    assert.equal(missing.json.error.code, "AUTH_REQUIRED");

    const product = await hit("GET", "/v1/internal/admin/wallets?ownerKind=user&ownerId=u", {
      headers: { "x-service-key": PRODUCT },
    });
    assert.equal(product.status, 403);
    assert.equal(product.json.error.code, "FORBIDDEN");

    const token = await new SignJWT({ sub: "user-1", org_id: "org-1" })
      .setProtectedHeader({ alg: "RS256", kid: "admin-test" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(privateKey);
    const user = await hit("GET", "/v1/internal/admin/settings", {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(user.status, 403);
    assert.equal(`${missing.text}${product.text}${user.text}`.includes(INTERNAL), false);
  });

  test("internal service reads settings, wallets, usage, rate cards, and masked connections", async () => {
    const settings = await hit("GET", "/v1/internal/admin/settings", { headers: internal() });
    assert.equal(settings.status, 200, settings.text);
    assert.equal(settings.json.publicApiEnabled, false);
    assert.equal(settings.json.publicApiSource, "env");
    assert.equal(settings.json.walletEnforce, false);
    assert.equal(typeof settings.json.hardeningGates.authn, "boolean");
    assert.equal(settings.text.includes(INTERNAL), false);

    const granted = await hit("POST", "/v1/internal/credits/grant", {
      headers: internal(),
      body: {
        orderId: "admin:lookup-1",
        walletOwner: { kind: "user", id: "user-admin-lookup" },
        amountMicro: 5000,
        kind: "promo",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    assert.equal(granted.status, 200, granted.text);

    const wallet = await hit(
      "GET",
      "/v1/internal/admin/wallets?ownerKind=user&ownerId=user-admin-lookup",
      { headers: internal() },
    );
    assert.equal(wallet.status, 200, wallet.text);
    assert.equal(wallet.json.reconciliation.grantedMicro, 5000);
    assert.equal(wallet.json.reconciliation.balanced, true);
    assert.equal(wallet.json.grants.length, 1);
    assert.equal(wallet.json.grants[0].sourceId, "admin:lookup-1");

    const { DataSource } = await import("typeorm");
    const db = app.get(DataSource);
    await db.query(
      `INSERT INTO ai_usage_events (
         id, product_code, subject_id, provider_type, model, prompt_tokens, completion_tokens,
         billed, at, feature, charged_micro, upstream_cost_micro_usd
       ) VALUES ($1, 'blockyedu', 'stu', 'openai', 'gpt-4o-mini', 10, 5, 'hosted', now(), 'chat.text', 3000, 1000)`,
      [randomUUID()],
    );
    const usage = await hit("GET", "/v1/internal/admin/usage?productCode=blockyedu", { headers: internal() });
    assert.equal(usage.status, 200, usage.text);
    assert.equal(usage.json.summary.calls, 1);
    assert.equal(usage.json.summary.chargedMicro, 3000);
    assert.equal(usage.json.summary.upstreamCostMicroUsd, 1000);
    assert.equal(usage.json.summary.marginMicro, 2000);
    assert.equal(usage.json.groups[0].capability, "chat.text");

    const published = await hit("POST", "/v1/internal/rate-cards", {
      headers: internal(),
      body: {
        id: "default",
        version: 1,
        effectiveFrom: new Date().toISOString(),
        lines: [
          {
            capability: "chat.text",
            providerType: "openai",
            model: "gpt-4o-mini",
            unit: "1k_input_tokens",
            upstreamCostMicroUsd: 1000,
            markupBps: 1000,
            fixedFeeMicro: 0,
          },
        ],
      },
    });
    assert.equal(published.status, 200, published.text);
    const cards = await hit("GET", "/v1/internal/admin/rate-cards", { headers: internal() });
    assert.equal(cards.status, 200, cards.text);
    assert.equal(cards.json.versions[0].id, "default");
    assert.equal(cards.json.versions[0].lines[0].unit, "1k_input_tokens");

    await db.query(
      `INSERT INTO provider_connections (
         uid, owner_kind, owner_uid, provider_type, display_name, model, enabled, ciphertext, secret_fingerprint
       ) VALUES ('conn_deploy_test', 'deployment', 'deployment', 'openai', 'OpenAI', 'gpt-4o-mini', true, 'super-secret-value', 'abcd1234')`,
    );
    const connections = await hit("GET", "/v1/internal/admin/connections", { headers: internal() });
    assert.equal(connections.status, 200, connections.text);
    assert.equal(connections.json.items[0].uid, "conn_deploy_test");
    assert.equal(connections.json.items[0].hasSecret, true);
    assert.equal(connections.text.includes("super-secret-value"), false);
    assert.equal(connections.text.includes("ciphertext"), false);
  });

  test("public API setting overrides the env value and writes an audit row", async () => {
    process.env.PUBLIC_API_ENABLED = "false";
    const on = await hit("PUT", "/v1/internal/admin/settings/public-api", {
      headers: { ...internal(), "x-service-subject": "operator-9" },
      body: { enabled: true, reason: "operator open" },
    });
    assert.equal(on.status, 200, on.text);
    assert.equal(on.json.publicApiEnabled, true);
    assert.equal(on.json.publicApiSource, "persisted");
    const open = await hit("POST", "/v1/public/chat/complete", { body: { hello: true } });
    assert.equal(open.status, 501, open.text);

    const off = await hit("PUT", "/v1/internal/admin/settings/public-api", {
      headers: internal(),
      body: { enabled: false },
    });
    assert.equal(off.status, 200, off.text);
    const hidden = await hit("GET", "/v1/public/chat/complete");
    assert.equal(hidden.status, 404);

    const { DataSource } = await import("typeorm");
    const db = app.get(DataSource);
    const audits = await db.query(
      `SELECT actor_sub, next_json->>'enabled' AS enabled FROM platform_setting_audits ORDER BY created_at ASC`,
    );
    assert.equal(audits[0].actor_sub, "operator-9");
    assert.equal(audits[0].enabled, "true");

    await db.query(`DELETE FROM platform_settings WHERE setting_key = 'public_api_enabled'`);
    const { clearPublicApiSnapshot } = await import("../dist/policy.js");
    clearPublicApiSnapshot();
    process.env.PUBLIC_API_ENABLED = "true";
    const fromEnv = await hit("POST", "/v1/public/chat/complete", { body: { hello: true } });
    assert.equal(fromEnv.status, 501, fromEnv.text);
    process.env.PUBLIC_API_ENABLED = "false";
    clearPublicApiSnapshot();
  });
});

function internal() {
  return { "x-service-key": INTERNAL };
}

async function hit(method, url, { headers = {}, body } = {}) {
  const res = await fastify.inject({
    method,
    url,
    headers: {
      ...headers,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.statusCode, json, text: res.body, headers: res.headers };
}

function docker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || stdout || `docker ${args[0]} failed`));
      else resolve(stdout.trim());
    });
  });
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await docker(["exec", CONTAINER, "pg_isready", "-U", "ai", "-d", "ai_platform"]);
      return docker(["port", CONTAINER, "5432"]);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("postgres container did not become ready");
}
