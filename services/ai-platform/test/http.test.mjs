import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { decryptSecret } from "@luminaryworks/ai-client";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const SERVICE_KEY = "test-service-key-0123456789";
const MASTER_KEY = "ab".repeat(32);
const ISSUER = "https://id.example.test/oidc";
const AUDIENCE = "https://ai.luminaryworks.dev";
const CONTAINER = `lw-ai-p1-${process.pid}`;

let app;
let fastify;
let entServer;
let jwksServer;
let privateKey;
let entCalls;
let dropEntitlement = false;

before(async () => {
  await docker(["rm", "-f", CONTAINER]).catch(() => {});
  await docker([
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_USER=ai",
    "-e",
    "POSTGRES_PASSWORD=ai_platform_test",
    "-e",
    "POSTGRES_DB=ai_platform",
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);
  const mapped = await waitForPostgres();
  const port = Number(mapped.split(":").pop());
  if (!port) throw new Error(`could not parse postgres port from ${mapped}`);

  entCalls = [];
  entServer = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      entCalls.push({ url: req.url, headers: req.headers, body });
      if (dropEntitlement) {
        res.destroy();
        return;
      }
      const feature = body.features?.[0]?.featureCode;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ results: [{ featureCode: feature, allowed: feature !== "ai.denied" }] }));
    });
  });
  await new Promise((resolve) => entServer.listen(0, "127.0.0.1", resolve));
  const entAddress = entServer.address();
  const entPort = typeof entAddress === "object" && entAddress ? entAddress.port : 0;

  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  jwksServer = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const jwksAddress = jwksServer.address();
  const jwksPort = typeof jwksAddress === "object" && jwksAddress ? jwksAddress.port : 0;

  process.env.NODE_ENV = "production";
  process.env.AI_PLATFORM_DATABASE_URL = `postgres://ai:ai_platform_test@127.0.0.1:${port}/ai_platform`;
  process.env.AI_PLATFORM_MIGRATIONS_RUN = "true";
  process.env.AI_PLATFORM_SERVICE_API_KEY = SERVICE_KEY;
  process.env.AI_PLATFORM_SERVICE_PRODUCT_CODES = "blockyedu,dataluminary";
  delete process.env.AI_PLATFORM_SERVICE_CREDENTIALS_JSON;
  delete process.env.AI_PLATFORM_SERVICE_INTERNAL;
  process.env.AI_PLATFORM_WALLET_ENFORCE = "false";
  process.env.AI_PLATFORM_AUTH_MODE = "oidc";
  delete process.env.AI_PLATFORM_LEGACY_JWT_SECRET;
  process.env.AI_PLATFORM_OIDC_ISSUER = ISSUER;
  process.env.AI_PLATFORM_OIDC_AUDIENCE = AUDIENCE;
  process.env.AI_PLATFORM_JWKS_URI = `http://127.0.0.1:${jwksPort}/jwks`;
  process.env.AI_VAULT_MASTER_KEY = MASTER_KEY;
  process.env.PUBLIC_API_ENABLED = "false";
  process.env.ENTITLEMENT_BASE_URL = `http://127.0.0.1:${entPort}`;
  process.env.ENTITLEMENT_SERVICE_API_KEY = "ent-service-key-012345";
  process.env.AI_PRODUCT_POLICIES_JSON = JSON.stringify([
    {
      productCode: "blockyedu",
      allowedCapabilities: ["chat.text"],
      defaultTier: {},
      userSelectable: [
        { capability: "chat.text", options: [{ label: "Fast", routeId: "route-fast", multiplier: 1 }] },
      ],
      contentSafety: "k12",
      logPrompts: false,
    },
  ]);

  const { NestFactory } = await import("@nestjs/core");
  const { FastifyAdapter } = await import("@nestjs/platform-fastify");
  const { AppModule } = await import("../dist/app.module.js");
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  await app.init();
  fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
});

after(async () => {
  dropEntitlement = false;
  if (app) await app.close();
  if (entServer) await new Promise((resolve) => entServer.close(resolve));
  if (jwksServer) await new Promise((resolve) => jwksServer.close(resolve));
  await docker(["rm", "-f", CONTAINER]).catch(() => {});
});

test("anonymous business routes return AUTH_REQUIRED; health and ready stay open", async () => {
  const denied = await hit("GET", "/v1/providers");
  assert.equal(denied.status, 401);
  assert.equal(denied.json.error.code, "AUTH_REQUIRED");

  const health = await hit("GET", "/v1/health");
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);

  const ready = await hit("GET", "/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.json.info.database.status, "up");
  assert.equal(ready.json.info.vault.status, "up");
  assert.equal(ready.json.info.connections.enabled, 0);
});

test("service credential and OIDC JWT both authenticate product routes", async () => {
  const byHeader = await hit("GET", "/v1/providers", { headers: { "x-service-key": SERVICE_KEY } });
  assert.equal(byHeader.status, 200);
  assert.ok(Array.isArray(byHeader.json.items));

  const wrong = await hit("GET", "/v1/providers", { headers: { "x-service-key": "nope" } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error.code, "AUTH_REQUIRED");

  const byBearer = await hit("GET", "/v1/usage", {
    headers: { authorization: `Bearer ${SERVICE_KEY}` },
  });
  assert.equal(byBearer.status, 200);

  const token = await userToken("user-jwt", "org-jwt");
  const byJwt = await hit("GET", "/v1/usage", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(byJwt.status, 200);
  assert.deepEqual(byJwt.json.items, []);
});

test("PUBLIC_API_ENABLED hides /v1/public and does not affect product routes", async () => {
  process.env.PUBLIC_API_ENABLED = "false";
  const hidden = await hit("GET", "/v1/public/chat/complete");
  assert.equal(hidden.status, 404);
  assert.equal(JSON.stringify(hidden.json).toLowerCase().includes("public"), false);
  assert.equal(JSON.stringify(hidden.json).includes("PUBLIC_API"), false);

  const productOff = await hit("GET", "/v1/providers", { headers: auth() });
  assert.equal(productOff.status, 200);

  process.env.PUBLIC_API_ENABLED = "true";
  const open = await hit("POST", "/v1/public/chat/complete", { body: { hello: true } });
  assert.equal(open.status, 501);
  assert.equal(open.json.error.code, "NOT_IMPLEMENTED");

  const productOn = await hit("GET", "/v1/providers", { headers: auth() });
  assert.equal(productOn.status, 200);
  process.env.PUBLIC_API_ENABLED = "false";
});

test("v2 validates and returns 501; v1 chat and embeddings stay on their own routes", async () => {
  const anon = await hit("POST", "/v2/chat/complete", { body: chatBody() });
  assert.equal(anon.status, 401);
  assert.equal(anon.json.error.code, "AUTH_REQUIRED");

  const missingTokens = await hit("POST", "/v2/chat/complete", {
    headers: auth(),
    body: chatBody({ maxTokens: undefined }),
  });
  assert.equal(missingTokens.status, 400);
  assert.equal(missingTokens.json.error.code, "VALIDATION_ERROR");

  const missingKey = await hit("POST", "/v2/chat/complete", {
    headers: auth(),
    body: chatBody({ idempotencyKey: "" }),
  });
  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.json.error.code, "VALIDATION_ERROR");

  const badRoute = await hit("POST", "/v2/chat/complete", {
    headers: auth(),
    body: chatBody({ routeId: "not-allowed" }),
  });
  assert.equal(badRoute.status, 400);
  assert.equal(badRoute.json.error.code, "MODEL_NOT_ALLOWED");

  const accepted = await hit("POST", "/v2/chat/complete", {
    headers: auth(),
    body: chatBody({ routeId: "route-fast" }),
  });
  assert.equal(accepted.status, 501);
  assert.equal(accepted.json.error.code, "NOT_IMPLEMENTED");

  const v1 = await hit("POST", "/v1/chat/complete", {
    headers: auth(),
    body: {
      connectionUid: "missing",
      messages: [{ role: "user", content: "hi" }],
      subjectId: "subj-1",
      organizationId: "org-1",
    },
  });
  assert.notEqual(v1.status, 501);
  assert.notEqual(v1.status, 401);

  const embed = await hit("POST", "/v1/embeddings", { headers: auth(), body: { texts: ["alpha"] } });
  assert.equal(embed.status, 201);
  assert.equal(embed.json.model, "sha256-16");
  assert.equal(embed.json.vectors.length, 1);
});

test("production stores vault ciphertext and rejects body secrets off the test route", async () => {
  const blocked = await hit("POST", "/v1/chat/complete", {
    headers: auth(),
    body: {
      ephemeral: { providerType: "openai", model: "gpt-test", secret: "sk-body-secret" },
      messages: [{ role: "user", content: "hi" }],
      subjectId: "subj-1",
      organizationId: "org-1",
    },
  });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.json.error.code, "EPHEMERAL_NOT_ALLOWED");

  const probed = await hit("POST", "/v1/providers/test", {
    headers: auth(),
    body: {
      ephemeral: { providerType: "openai", model: "gpt-test", secret: "sk-body-secret" },
      subjectId: "subj-1",
      organizationId: "org-1",
    },
  });
  assert.notEqual(probed.json?.error?.code, "EPHEMERAL_NOT_ALLOWED");

  const saved = await hit("POST", "/v1/providers", {
    headers: auth(),
    body: {
      ownerKind: "user",
      ownerUid: "user-1",
      providerType: "openai",
      displayName: "personal",
      model: "gpt-test",
      secret: "sk-personal-secret",
    },
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.json.secretFingerprint, "cret");
  assert.equal(saved.json.ciphertext, undefined);
  assert.equal(JSON.stringify(saved.json).includes("sk-personal-secret"), false);

  const { DataSource } = await import("typeorm");
  const ds = app.get(DataSource);
  const rows = await ds.query("select ciphertext from provider_connections where uid = $1", [saved.json.uid]);
  assert.match(rows[0].ciphertext, /^v1:/);
  assert.equal(rows[0].ciphertext.includes("sk-personal-secret"), false);
  assert.equal(decryptSecret(MASTER_KEY, rows[0].ciphertext), "sk-personal-secret");

  const previous = process.env.AI_VAULT_MASTER_KEY;
  delete process.env.AI_VAULT_MASTER_KEY;
  const refused = await hit("POST", "/v1/providers", {
    headers: auth(),
    body: {
      ownerKind: "user",
      ownerUid: "user-1",
      providerType: "openai",
      displayName: "no-key",
      model: "gpt-test",
      secret: "sk-should-not-save",
    },
  });
  assert.equal(refused.status, 503);
  assert.equal(refused.json.error.code, "VAULT_UNAVAILABLE");
  const notReady = await hit("GET", "/ready");
  assert.equal(notReady.status, 503);
  process.env.AI_VAULT_MASTER_KEY = previous;
  const ready = await hit("GET", "/ready");
  assert.equal(ready.status, 200);
  assert.ok(ready.json.info.connections.enabled >= 1);
});

test("usage events survive in Postgres, including nullable billing columns", async () => {
  const { AiGatewayService } = await import("../dist/ai-gateway.service.js");
  const { DataSource } = await import("typeorm");
  const service = app.get(AiGatewayService);
  await service.recordUsage({
    productCode: "blockyedu",
    subjectId: "stu-meter",
    feature: "ai.voice",
    purpose: "chat",
    providerType: "openai",
    model: "gpt-test",
    promptTokens: 3,
    completionTokens: 4,
    billed: "managed",
    at: new Date().toISOString(),
    traceId: "trc-persist-1",
    walletId: "wal-1",
    grantIds: ["g1"],
    rateCardId: "rc-1",
    rateCardVersion: 3,
    upstreamCostMicroUsd: 15,
    chargedMicro: 20,
    routeId: "route-fast",
    attemptIndex: 2,
    partial: false,
    surface: "public",
    apiKeyId: "key-1",
  });

  const listed = await service.listUsage({
    kind: "service",
    subjectId: "service:internal",
    surface: "product",
    organizationId: null,
  });
  const found = listed.find((row) => row.traceId === "trc-persist-1");
  assert.ok(found);
  assert.equal(found.walletId, "wal-1");
  assert.deepEqual(found.grantIds, ["g1"]);
  assert.equal(found.surface, "public");

  const ds2 = new DataSource({
    type: "postgres",
    url: process.env.AI_PLATFORM_DATABASE_URL,
  });
  await ds2.initialize();
  try {
    const rows = await ds2.query(
      `select wallet_id, route_id, attempt_index, partial, surface, api_key_id,
              upstream_cost_micro_usd, charged_micro, rate_card_version, grant_ids
       from ai_usage_events where trace_id = $1`,
      ["trc-persist-1"],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].wallet_id, "wal-1");
    assert.equal(rows[0].route_id, "route-fast");
    assert.equal(Number(rows[0].attempt_index), 2);
    assert.equal(rows[0].partial, false);
    assert.equal(rows[0].surface, "public");
    assert.equal(rows[0].api_key_id, "key-1");
    assert.equal(Number(rows[0].upstream_cost_micro_usd), 15);
    assert.equal(Number(rows[0].charged_micro), 20);
    assert.equal(String(rows[0].rate_card_version), "3");
  } finally {
    await ds2.destroy();
  }
});

test("hosted calls fail closed on Entitlement; BYOK does not consult it", async () => {
  const hosted = await hit("POST", "/v1/providers", {
    headers: auth(),
    body: {
      ownerKind: "deployment",
      ownerUid: "platform",
      providerType: "openai",
      displayName: "hosted",
      model: "gpt-test",
      secret: "sk-hosted-secret",
    },
  });
  assert.equal(hosted.status, 201);
  const before = entCalls.length;

  const missing = await hit("POST", "/v1/chat/complete", {
    headers: auth(),
    body: {
      connectionUid: hosted.json.uid,
      messages: [{ role: "user", content: "hi" }],
    },
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error.code, "VALIDATION_ERROR");
  assert.equal(entCalls.length, before);

  const denied = await hit("POST", "/v1/chat/complete", {
    headers: auth(),
    body: {
      connectionUid: hosted.json.uid,
      productCode: "dataluminary",
      subjectId: "subj-1",
      organizationId: "org-1",
      feature: "ai.denied",
      messages: [{ role: "user", content: "hi" }],
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error.code, "ENTITLEMENT_DENIED");
  assert.equal(entCalls.length, before + 1);
  assert.equal(entCalls.at(-1).body.productCode, "dataluminary");
  assert.equal(entCalls.at(-1).body.features[0].featureCode, "ai.denied");
  assert.equal(entCalls.at(-1).headers["x-act-as-subject"], "subj-1");

  const cached = await hit("POST", "/v1/chat/complete", {
    headers: auth(),
    body: {
      connectionUid: hosted.json.uid,
      productCode: "dataluminary",
      subjectId: "subj-1",
      organizationId: "org-1",
      feature: "ai.denied",
      messages: [{ role: "user", content: "hi" }],
    },
  });
  assert.equal(cached.status, 403);
  assert.equal(entCalls.length, before + 1);

  const userConn = await hit("POST", "/v1/providers", {
    headers: auth(),
    body: {
      ownerKind: "organization",
      ownerUid: "org-1",
      providerType: "openai",
      displayName: "byok",
      model: "gpt-test",
      secret: "sk-byok-secret",
    },
  });
  const byok = await hit("POST", "/v1/chat/complete", {
    headers: auth(),
    body: {
      connectionUid: userConn.json.uid,
      productCode: "dataluminary",
      subjectId: "subj-1",
      organizationId: "org-1",
      feature: "ai.denied",
      messages: [{ role: "user", content: "hi" }],
    },
  });
  assert.notEqual(byok.status, 403);
  assert.equal(entCalls.length, before + 1);

  dropEntitlement = true;
  const down = await hit("POST", "/v1/chat/complete", {
    headers: auth(),
    body: {
      connectionUid: hosted.json.uid,
      productCode: "dataluminary",
      subjectId: "subj-2",
      organizationId: "org-1",
      feature: "ai.analysis",
      messages: [{ role: "user", content: "hi" }],
    },
  });
  assert.equal(down.status, 503);
  assert.equal(down.json.error.code, "ENTITLEMENT_DENIED");
});

test("user JWT cannot impersonate subjectId, manage deployment connections, or read all usage", async () => {
  const headersA = { authorization: `Bearer ${await userToken("user-a", "org-a")}` };

  const deploy = await hit("POST", "/v1/providers", {
    headers: headersA,
    body: {
      ownerKind: "deployment",
      ownerUid: "platform",
      providerType: "openai",
      displayName: "nope",
      model: "gpt-test",
      secret: "sk-nope",
    },
  });
  assert.equal(deploy.status, 403);
  assert.equal(deploy.json.error.code, "FORBIDDEN");

  const otherUser = await hit("POST", "/v1/providers", {
    headers: headersA,
    body: {
      ownerKind: "user",
      ownerUid: "user-b",
      providerType: "openai",
      displayName: "other",
      model: "gpt-test",
      secret: "sk-other",
    },
  });
  assert.equal(otherUser.status, 403);
  assert.equal(otherUser.json.error.code, "FORBIDDEN");

  const own = await hit("POST", "/v1/providers", {
    headers: headersA,
    body: {
      ownerKind: "user",
      ownerUid: "user-a",
      providerType: "openai",
      displayName: "mine",
      model: "gpt-test",
      secret: "sk-mine-secret",
    },
  });
  assert.equal(own.status, 201);

  const org = await hit("POST", "/v1/providers", {
    headers: headersA,
    body: {
      ownerKind: "organization",
      ownerUid: "org-a",
      providerType: "openai",
      displayName: "org",
      model: "gpt-test",
      secret: "sk-org-secret",
    },
  });
  assert.equal(org.status, 201);

  const listed = await hit("GET", "/v1/providers", { headers: headersA });
  const ids = listed.json.items.map((item) => item.uid);
  assert.ok(ids.includes(own.json.uid));
  assert.ok(ids.includes(org.json.uid));
  assert.equal(listed.json.items.some((item) => item.ownerKind === "deployment"), false);
  assert.equal(listed.json.items.some((item) => item.ownerUid === "user-1"), false);

  const serviceList = await hit("GET", "/v1/providers", { headers: auth() });
  assert.equal(serviceList.json.items.some((item) => item.ownerKind === "deployment"), true);
  const personal = serviceList.json.items.find((item) => item.ownerUid === "user-1");
  const stolen = await hit("POST", "/v1/chat/complete", {
    headers: headersA,
    body: {
      connectionUid: personal.uid,
      messages: [{ role: "user", content: "hi" }],
    },
  });
  assert.equal(stolen.status, 403);
  assert.equal(stolen.json.error.code, "FORBIDDEN");

  const forged = await hit("POST", "/v1/chat/complete", {
    headers: headersA,
    body: {
      connectionUid: own.json.uid,
      messages: [{ role: "user", content: "hi" }],
      subjectId: "someone-else",
      organizationId: "org-a",
    },
  });
  assert.equal(forged.status, 403);
  assert.equal(forged.json.error.code, "ENTITLEMENT_DENIED");

  const wrongOrg = await hit("POST", "/v1/chat/complete", {
    headers: headersA,
    body: {
      connectionUid: own.json.uid,
      messages: [{ role: "user", content: "hi" }],
      organizationId: "other-org",
    },
  });
  assert.equal(wrongOrg.status, 403);
  assert.equal(wrongOrg.json.error.code, "ENTITLEMENT_DENIED");

  const space = await hit("POST", "/v1/providers", {
    headers: headersA,
    body: {
      ownerKind: "space",
      ownerUid: "space-1",
      providerType: "openai",
      displayName: "space",
      model: "gpt-test",
      secret: "sk-space",
    },
  });
  assert.equal(space.status, 403);
  assert.equal(space.json.error.code, "FORBIDDEN");

  const { AiGatewayService } = await import("../dist/ai-gateway.service.js");
  const service = app.get(AiGatewayService);
  await service.recordUsage({
    productCode: "blockyedu",
    subjectId: "user-a",
    providerType: "openai",
    model: "gpt-test",
    promptTokens: 1,
    completionTokens: 1,
    billed: "byok",
    at: new Date().toISOString(),
    traceId: "trc-user-a",
  });
  await service.recordUsage({
    productCode: "blockyedu",
    subjectId: "user-b",
    providerType: "openai",
    model: "gpt-test",
    promptTokens: 1,
    completionTokens: 1,
    billed: "byok",
    at: new Date().toISOString(),
    traceId: "trc-user-b",
  });
  const mine = await hit("GET", "/v1/usage", { headers: headersA });
  assert.ok(mine.json.items.some((item) => item.traceId === "trc-user-a"));
  assert.equal(mine.json.items.some((item) => item.traceId === "trc-user-b"), false);
  const all = await hit("GET", "/v1/usage", { headers: auth() });
  assert.ok(all.json.items.some((item) => item.traceId === "trc-user-b"));

  const serviceWrite = await hit("POST", "/v1/providers", {
    headers: auth(),
    body: {
      ownerKind: "deployment",
      ownerUid: "platform",
      providerType: "openai",
      displayName: "still-ok",
      model: "gpt-test",
      secret: "sk-service-ok",
    },
  });
  assert.equal(serviceWrite.status, 201);
});

function auth() {
  return { "x-service-key": SERVICE_KEY };
}

function userToken(sub, org) {
  return new SignJWT({ sub, org_id: org })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("5m")
    .sign(privateKey);
}

function chatBody(overrides = {}) {
  return {
    capability: "chat.text",
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 16,
    productCode: "blockyedu",
    subjectId: "stu-1",
    idempotencyKey: "idem-1",
    ...overrides,
  };
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
  return { status: res.statusCode, json, text: res.body };
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
