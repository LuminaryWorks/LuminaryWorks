import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const SERVICE_KEY = "me-service-key-0123456789";
const MASTER_KEY = "ab".repeat(32);
const ISSUER = "https://id.example.test/oidc";
const AUDIENCE = "https://ai.luminaryworks.dev";
const CONTAINER = `lw-ai-me-${process.pid}`;

let app;
let fastify;
let jwksServer;
let privateKey;

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

  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  jwksServer = (await import("node:http")).createServer((_req, res) => {
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
  process.env.AI_PLATFORM_SERVICE_PRODUCT_CODES = "dataluminary";
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
  delete process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS;
  delete process.env.AI_PLATFORM_CORS_ORIGINS;
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

  const { WalletService } = await import("../dist/wallet/wallet.service.js");
  const wallet = app.get(WalletService);
  await wallet.grantCredits({
    ownerKind: "user",
    ownerId: "user-a",
    currency: "USD",
    kind: "topup",
    amountMicro: 5_000_000n,
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    restrictProductCodes: ["dataluminary"],
    restrictCapabilities: ["chat.text"],
    sourceType: "order",
    sourceId: `order-${process.pid}`,
  });

  const { AiUsageEventEntity } = await import("../dist/database/entities/ai-usage-event.entity.js");
  const { DataSource } = await import("typeorm");
  const usage = app.get(DataSource).getRepository(AiUsageEventEntity);
  await usage.save(
    usage.create({
      id: randomUUID(),
      productCode: "dataluminary",
      subjectId: "user-a",
      providerType: "openai",
      model: "fixture-a",
      billed: "managed",
      status: "ok",
      at: new Date("2026-01-02T00:00:00.000Z"),
      chargedMicro: 1200,
      promptTokens: 3,
      completionTokens: 4,
    }),
  );
}, { timeout: 180_000 });

after(async () => {
  if (app) await app.close();
  if (jwksServer) await new Promise((resolve) => jwksServer.close(resolve));
  await docker(["rm", "-f", CONTAINER]).catch(() => {});
});

test("anonymous /v1/me routes return AUTH_REQUIRED", async () => {
  for (const url of ["/v1/me/wallet", "/v1/me/grants", "/v1/me/usage"]) {
    const denied = await hit("GET", url);
    assert.equal(denied.status, 401, denied.text);
    assert.equal(denied.json.error.code, "AUTH_REQUIRED");
  }
});

test("service credentials are rejected on /v1/me", async () => {
  for (const headers of [
    { "x-service-key": SERVICE_KEY },
    { authorization: `Bearer ${SERVICE_KEY}` },
  ]) {
    for (const url of ["/v1/me/wallet", "/v1/me/grants", "/v1/me/usage"]) {
      const denied = await hit("GET", url, { headers });
      assert.equal(denied.status, 403, denied.text);
      assert.equal(denied.json.error.code, "FORBIDDEN");
    }
  }
});

test("user A cannot read user B wallet, grants, or usage", async () => {
  const headersA = { authorization: `Bearer ${await userToken("user-a")}` };
  const headersB = { authorization: `Bearer ${await userToken("user-b")}` };

  const walletA = await hit("GET", "/v1/me/wallet", { headers: headersA });
  assert.equal(walletA.status, 200, walletA.text);
  assert.equal(walletA.json.ownerKind, "user");
  assert.equal(walletA.json.ownerId, "user-a");
  assert.equal(walletA.json.remainingMicro, 5_000_000);
  assert.equal(walletA.json.heldMicro, 0);
  assert.equal(walletA.json.settledMicro, 0);

  const walletB = await hit("GET", "/v1/me/wallet", { headers: headersB });
  assert.equal(walletB.status, 200, walletB.text);
  assert.equal(walletB.json.ownerId, "user-b");
  assert.notEqual(walletB.json.walletId, walletA.json.walletId);
  assert.equal(walletB.json.remainingMicro, 0);

  const spoofed = await hit("GET", "/v1/me/wallet?subjectId=user-a", { headers: headersB });
  assert.equal(spoofed.status, 400, spoofed.text);
  assert.equal(spoofed.json.error.code, "VALIDATION_ERROR");
  assert.equal(spoofed.text.includes(walletA.json.walletId), false);

  const grantsA = await hit("GET", "/v1/me/grants", { headers: headersA });
  assert.equal(grantsA.status, 200, grantsA.text);
  assert.equal(grantsA.json.items.length, 1);
  assert.equal(grantsA.json.items[0].remainingMicro, 5_000_000);
  assert.equal(grantsA.json.items[0].expiresAt, "2030-01-01T00:00:00.000Z");
  assert.deepEqual(grantsA.json.items[0].restrictProductCodes, ["dataluminary"]);
  assert.deepEqual(grantsA.json.items[0].restrictCapabilities, ["chat.text"]);

  const grantsB = await hit("GET", "/v1/me/grants", { headers: headersB });
  assert.equal(grantsB.status, 200, grantsB.text);
  assert.deepEqual(grantsB.json.items, []);
  const grantsSpoof = await hit("GET", "/v1/me/grants?subjectId=user-a", { headers: headersB });
  assert.equal(grantsSpoof.status, 400);

  const usageA = await hit("GET", "/v1/me/usage?limit=10", { headers: headersA });
  assert.equal(usageA.status, 200, usageA.text);
  assert.equal(usageA.json.items.length, 1);
  assert.equal(usageA.json.items[0].model, "fixture-a");
  assert.equal(usageA.json.items[0].chargedMicro, 1200);

  const usageB = await hit("GET", "/v1/me/usage?limit=10", { headers: headersB });
  assert.equal(usageB.status, 200, usageB.text);
  assert.deepEqual(usageB.json.items, []);

  const badLimit = await hit("GET", "/v1/me/usage?limit=0", { headers: headersA });
  assert.equal(badLimit.status, 400);
  assert.equal(badLimit.json.error.code, "VALIDATION_ERROR");
});

function userToken(sub) {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("5m")
    .sign(privateKey);
}

async function hit(method, url, { headers = {} } = {}) {
  const res = await fastify.inject({ method, url, headers });
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
