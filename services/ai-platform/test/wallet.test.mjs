import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const KEY_A = "credential-a-dataluminary";
const KEY_B = "credential-b-blockyedu-01";
const KEY_INTERNAL = "credential-internal-ledger";
const MASTER_KEY = "ab".repeat(32);
const ISSUER = "https://id.example.test/oidc";
const AUDIENCE = "https://ai.luminaryworks.dev";
const CONTAINER = `lw-ai-p2-${process.pid}`;

let app;
let fastify;
let entServer;
let jwksServer;
let mockServer;
let privateKey;
let entCalls;
let mockHits;
let hostedUid;
let byokUid;

describe("ai platform wallet and credential scope", { concurrency: 1 }, () => {
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

    entCalls = [];
    entServer = createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        entCalls.push(body);
        const feature = body.features?.[0]?.featureCode;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ results: [{ featureCode: feature, allowed: feature !== "ai.denied" }] }));
      });
    });
    await listen(entServer);
    const entPort = entServer.address().port;

    mockHits = 0;
    mockServer = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      mockHits += 1;
      const url = req.url || "";
      if (url.includes("/audio/transcriptions")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ text: "hello from fixture" }));
        return;
      }
      if (url.includes("/audio/speech")) {
        res.end(Buffer.from("fake-mp3-bytes"));
        return;
      }
      const body = raw ? JSON.parse(raw) : {};
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({
          choices: [{ delta: { content: "hi" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model: "fixture-model",
      }));
    });
    await listen(mockServer);
    const mockPort = mockServer.address().port;

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
    await listen(jwksServer);

    process.env.NODE_ENV = "production";
    process.env.AI_PLATFORM_DATABASE_URL = `postgres://ai:ai_platform_test@127.0.0.1:${port}/ai_platform`;
    process.env.AI_PLATFORM_MIGRATIONS_RUN = "true";
    process.env.AI_PLATFORM_SERVICE_API_KEY = KEY_A;
    process.env.AI_PLATFORM_SERVICE_PRODUCT_CODES = "dataluminary";
    process.env.AI_PLATFORM_SERVICE_INTERNAL = "false";
    process.env.AI_PLATFORM_SERVICE_CREDENTIALS_JSON = JSON.stringify([
      { key: KEY_B, productCodes: ["blockyedu"] },
      { key: KEY_INTERNAL, productCodes: ["luminaryworks"], internal: true },
    ]);
    process.env.AI_PLATFORM_AUTH_MODE = "oidc";
    process.env.AI_PLATFORM_OIDC_ISSUER = ISSUER;
    process.env.AI_PLATFORM_OIDC_AUDIENCE = AUDIENCE;
    process.env.AI_PLATFORM_JWKS_URI = `http://127.0.0.1:${jwksServer.address().port}/jwks`;
    process.env.AI_VAULT_MASTER_KEY = MASTER_KEY;
    process.env.AI_PLATFORM_DATA_DIR = `/tmp/lw-ai-p2-data-${process.pid}`;
    process.env.PUBLIC_API_ENABLED = "false";
    process.env.AI_PLATFORM_WALLET_ENFORCE = "true";
    process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS = "true";
    process.env.ENTITLEMENT_BASE_URL = `http://127.0.0.1:${entPort}`;
    process.env.ENTITLEMENT_SERVICE_API_KEY = "ent-service-key-012345";
    process.env.AI_PRODUCT_POLICIES_JSON = JSON.stringify([
      { productCode: "dataluminary", allowedCapabilities: ["chat.text"], defaultTier: {}, userSelectable: [], contentSafety: "standard", logPrompts: false },
      { productCode: "blockyedu", allowedCapabilities: ["chat.text"], defaultTier: {}, userSelectable: [], contentSafety: "k12", logPrompts: false },
    ]);

    const { NestFactory } = await import("@nestjs/core");
    const { FastifyAdapter } = await import("@nestjs/platform-fastify");
    const { AppModule } = await import("../dist/app.module.js");
    app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
    await app.init();
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();

    const { WalletService } = await import("../dist/wallet/wallet.service.js");
    const wallet = app.get(WalletService);
    await wallet.publishRateCard({
      id: "fixture",
      version: 1,
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      lines: [
        line("chat.text", "1k_input_tokens"),
        line("chat.text", "1k_output_tokens"),
        line("stt", "audio_second_in"),
        line("tts", "audio_second_out"),
      ],
    });
    await wallet.grantCredits(grantInput("organization", "org-rich", 100_000n, "bootstrap-rich"));
    await wallet.grantCredits(grantInput("organization", "org-poor", 1n, "bootstrap-poor"));

    const saved = await hit("POST", "/v1/providers", {
      headers: service(KEY_A),
      body: {
        ownerKind: "deployment",
        ownerUid: "platform",
        providerType: "openai",
        displayName: "hosted",
        model: "fixture-model",
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        secret: "sk-hosted-secret",
        purpose: "chat",
      },
    });
    assert.equal(saved.status, 201, saved.text);
    hostedUid = saved.json.uid;
    const byok = await hit("POST", "/v1/providers", {
      headers: service(KEY_A),
      body: {
        ownerKind: "organization",
        ownerUid: "org-rich",
        providerType: "openai",
        displayName: "byok",
        model: "fixture-model",
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        secret: "sk-byok-secret",
        purpose: "chat",
      },
    });
    assert.equal(byok.status, 201, byok.text);
    byokUid = byok.json.uid;
  }, { timeout: 180_000 });

  after(async () => {
    if (app) await app.close();
    if (entServer) await close(entServer);
    if (jwksServer) await close(jwksServer);
    if (mockServer) await close(mockServer);
    await docker(["rm", "-f", CONTAINER]).catch(() => {});
  });

  test("credential A can use product A and is rejected for product B or a missing productCode", async () => {
    const allowed = await hit("POST", "/v2/chat/complete", {
      headers: service(KEY_A),
      body: v2Body("dataluminary"),
    });
    assert.equal(allowed.status, 501);
    assert.equal(allowed.json.error.code, "NOT_IMPLEMENTED");

    const otherKey = await hit("POST", "/v2/chat/complete", {
      headers: service(KEY_B),
      body: v2Body("blockyedu", { idempotencyKey: "idem-b" }),
    });
    assert.equal(otherKey.status, 501);

    const wrong = await hit("POST", "/v2/chat/complete", {
      headers: service(KEY_A),
      body: v2Body("blockyedu", { idempotencyKey: "idem-wrong" }),
    });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.json.error.code, "FORBIDDEN");

    const missing = await hit("POST", "/v2/chat/complete", {
      headers: service(KEY_A),
      body: v2Body("", { productCode: undefined, idempotencyKey: "idem-missing" }),
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, "VALIDATION_ERROR");

    const beforeEnt = entCalls.length;
    const beforeMock = mockHits;
    const hostedWrong = await hit("POST", "/v1/chat/complete", {
      headers: service(KEY_A),
      body: hostedBody("blockyedu", "org-rich", "idem-hosted-wrong"),
    });
    assert.equal(hostedWrong.status, 403);
    assert.equal(hostedWrong.json.error.code, "FORBIDDEN");
    assert.equal(entCalls.length, beforeEnt);
    assert.equal(mockHits, beforeMock);

    const hostedMissing = await hit("POST", "/v1/chat/complete", {
      headers: service(KEY_A),
      body: hostedBody("dataluminary", "org-rich", "idem-hosted-missing", { productCode: undefined }),
    });
    assert.equal(hostedMissing.status, 400);
    assert.equal(hostedMissing.json.error.code, "VALIDATION_ERROR");
    assert.equal(entCalls.length, beforeEnt);
  });

  test("a user JWT still cannot call a hosted deployment connection", async () => {
    const token = await userToken("user-a", "org-a");
    const denied = await hit("POST", "/v1/chat/complete", {
      headers: { authorization: `Bearer ${token}` },
      body: {
        connectionUid: hostedUid,
        messages: [{ role: "user", content: "hi" }],
        productCode: "dataluminary",
        maxTokens: 8,
        idempotencyKey: "user-hosted",
        feature: "ai.analysis",
      },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, "FORBIDDEN");
    const v2 = await hit("POST", "/v2/chat/complete", {
      headers: { authorization: `Bearer ${token}` },
      body: v2Body("dataluminary", { idempotencyKey: "user-v2" }),
    });
    assert.equal(v2.status, 403);
    assert.equal(v2.json.error.code, "FORBIDDEN");
  });

  test("grant is idempotent on orderId and only an internal credential can grant or revoke", async () => {
    const body = {
      orderId: "ord-http-1",
      walletOwner: { kind: "user", id: "user-http-1" },
      amountMicro: 5000,
      currency: "USD",
      kind: "topup",
    };
    const denied = await hit("POST", "/v1/internal/credits/grant", { headers: service(KEY_A), body });
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, "FORBIDDEN");

    const first = await hit("POST", "/v1/internal/credits/grant", { headers: service(KEY_INTERNAL), body });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.created, true);
    assert.equal(first.json.amountMicro, 5000);
    const second = await hit("POST", "/v1/internal/credits/grant", { headers: service(KEY_INTERNAL), body });
    assert.equal(second.status, 200);
    assert.equal(second.json.created, false);
    assert.equal(second.json.grantId, first.json.grantId);

    const { DataSource } = await import("typeorm");
    const rows = await app.get(DataSource).query(
      `SELECT count(*)::int AS n FROM credit_grants WHERE source_type = 'order' AND source_id = $1`,
      ["ord-http-1"],
    );
    assert.equal(rows[0].n, 1);

    const conflict = await hit("POST", "/v1/internal/credits/grant", {
      headers: service(KEY_INTERNAL),
      body: { ...body, amountMicro: 100 },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.error.code, "IDEMPOTENCY_CONFLICT");
  });

  test("spend order, partial settle, release, and the reconciliation equation", async () => {
    const { WalletService } = await import("../dist/wallet/wallet.service.js");
    const wallet = app.get(WalletService);
    const ownerId = "org-equation";
    const soon = new Date(Date.now() + 60_000);
    const later = new Date(Date.now() + 3_600_000);
    await wallet.grantCredits({
      ...grantInput("organization", ownerId, 4000n, "eq-restricted"),
      kind: "subscription",
      expiresAt: soon,
      restrictProductCodes: ["dataluminary"],
      restrictCapabilities: ["chat.text"],
    });
    await wallet.grantCredits({
      ...grantInput("organization", ownerId, 3000n, "eq-general"),
      kind: "subscription",
      expiresAt: later,
    });
    await wallet.grantCredits(grantInput("organization", ownerId, 10_000n, "eq-topup"));
    const ensured = await wallet.ensureWallet("organization", ownerId);
    const reserved = await wallet.reserve({
      requestId: "eq-reserve",
      walletId: ensured.walletId,
      estimateMicro: 6000n,
      productCode: "dataluminary",
      capability: "chat.text",
    });
    assert.equal(reserved.created, true);
    let grants = await wallet.listGrants(ensured.walletId);
    assert.equal(remaining(grants, "eq-restricted"), 0n);
    assert.equal(remaining(grants, "eq-general"), 1000n);
    assert.equal(remaining(grants, "eq-topup"), 10_000n);
    let recon = await wallet.reconciliation(ensured.walletId);
    assert.equal(recon.revokedMicro, 0n);
    assert.equal(recon.grantedMicro, recon.remainingMicro + recon.activeHoldMicro + recon.settledMicro);

    const settled = await wallet.settle({
      requestId: "eq-reserve",
      capability: "chat.text",
      providerType: "openai",
      model: "fixture-model",
      usage: { promptTokens: 2500, completionTokens: 0 },
    });
    assert.equal(settled.chargedMicro, 2500n);
    assert.equal(settled.overrunMicro, 0n);
    assert.equal(settled.idempotent, false);
    grants = await wallet.listGrants(ensured.walletId);
    assert.equal(remaining(grants, "eq-restricted"), 1500n);
    assert.equal(remaining(grants, "eq-general"), 3000n);
    assert.equal(remaining(grants, "eq-topup"), 10_000n);
    const again = await wallet.settle({
      requestId: "eq-reserve",
      capability: "chat.text",
      providerType: "openai",
      model: "fixture-model",
      usage: { promptTokens: 9999, completionTokens: 0 },
    });
    assert.equal(again.idempotent, true);
    assert.equal(again.chargedMicro, 2500n);

    const second = await wallet.reserve({
      requestId: "eq-release",
      walletId: ensured.walletId,
      estimateMicro: 4000n,
      productCode: "dataluminary",
      capability: "chat.text",
    });
    assert.equal(second.created, true);
    const released = await wallet.release("eq-release");
    assert.equal(released.status, "released");
    assert.equal(released.releasedMicro, 4000n);
    const releasedAgain = await wallet.release("eq-release");
    assert.equal(releasedAgain.idempotent, true);
    recon = await wallet.reconciliation(ensured.walletId);
    assert.equal(recon.activeHoldMicro, 0n);
    assert.equal(recon.settledMicro, 2500n);
    assert.equal(recon.grantedMicro, recon.remainingMicro + recon.activeHoldMicro + recon.settledMicro);
  });

  test("partial revoke leaves remaining spendable and accumulates clawback", async () => {
    const { WalletService } = await import("../dist/wallet/wallet.service.js");
    const wallet = app.get(WalletService);
    const granted = await wallet.grantCredits(grantInput("user", "user-partial-rev", 10_000n, "ord-partial-rev"));
    const first = await wallet.revokeBySource("order", "ord-partial-rev", 4_000n, { seal: false });
    assert.equal(first.recoveredMicro, 4000n);
    assert.equal(first.remainingMicro, 6000n);
    assert.equal(first.idempotent, false);
    const [afterFirst] = await wallet.listGrants(granted.walletId);
    assert.equal(afterFirst.revokedAt, null);
    await wallet.reserve({
      requestId: "partial-rev-spend",
      walletId: granted.walletId,
      estimateMicro: 1000n,
      productCode: "dataluminary",
      capability: "chat.text",
    });
    const second = await wallet.revokeBySource("order", "ord-partial-rev", 3_000n, { seal: false });
    assert.equal(second.recoveredMicro, 3000n);
    assert.equal(second.remainingMicro, 2000n);
    const sealed = await wallet.revokeBySource("order", "ord-partial-rev", undefined, { seal: true });
    assert.equal(sealed.recoveredMicro, 2000n);
    const [finalGrant] = await wallet.listGrants(granted.walletId);
    assert.ok(finalGrant.revokedAt);
    assert.equal(finalGrant.remainingMicro, 0n);
  });

  test("revoke recovers only remaining and a repeat revoke does not move more", async () => {
    const { WalletService } = await import("../dist/wallet/wallet.service.js");
    const wallet = app.get(WalletService);
    const granted = await wallet.grantCredits(grantInput("user", "user-revoke", 10_000n, "ord-revoke"));
    await wallet.reserve({
      requestId: "revoke-hold",
      walletId: granted.walletId,
      estimateMicro: 4000n,
      productCode: "dataluminary",
      capability: "chat.text",
    });
    await wallet.settle({
      requestId: "revoke-hold",
      capability: "chat.text",
      providerType: "openai",
      model: "fixture-model",
      usage: { promptTokens: 4000, completionTokens: 0 },
    });
    const http = await hit("POST", "/v1/internal/credits/revoke", {
      headers: service(KEY_INTERNAL),
      body: { orderId: "ord-revoke" },
    });
    assert.equal(http.status, 200, http.text);
    assert.equal(http.json.recoveredMicro, 6000);
    assert.equal(http.json.shortfallMicro, 4000);
    assert.equal(http.json.remainingMicro, 0);
    assert.equal(http.json.idempotent, false);
    const repeat = await hit("POST", "/v1/internal/credits/revoke", {
      headers: service(KEY_INTERNAL),
      body: { orderId: "ord-revoke", amountMicro: 1 },
    });
    assert.equal(repeat.json.idempotent, true);
    assert.equal(repeat.json.recoveredMicro, 6000);
    assert.equal(repeat.json.shortfallMicro, 4000);
    const recon = await wallet.reconciliation(granted.walletId);
    assert.equal(recon.settledMicro, 4000n);
    assert.equal(recon.revokedMicro, 6000n);
    assert.equal(recon.remainingMicro, 0n);
    assert.equal(
      recon.grantedMicro,
      recon.remainingMicro + recon.activeHoldMicro + recon.settledMicro + recon.revokedMicro,
    );
  });

  test("release after revoke claws the hold back and a new reserve is refused", async () => {
    const { WalletService } = await import("../dist/wallet/wallet.service.js");
    const { DataSource } = await import("typeorm");
    const wallet = app.get(WalletService);
    const granted = await wallet.grantCredits(grantInput("user", "user-claw-release", 1000n, "ord-claw-release"));
    await wallet.reserve({
      requestId: "claw-release-hold",
      walletId: granted.walletId,
      estimateMicro: 800n,
      productCode: "dataluminary",
      capability: "chat.text",
    });
    const revoked = await wallet.revokeBySource("order", "ord-claw-release");
    assert.equal(revoked.recoveredMicro, 200n);
    assert.equal(revoked.shortfallMicro, 800n);
    assert.equal(revoked.remainingMicro, 0n);

    await wallet.release("claw-release-hold");
    const [grant] = await wallet.listGrants(granted.walletId);
    assert.equal(grant.remainingMicro, 0n);
    assert.equal(grant.revokedMicro, 1000n);
    assert.equal(grant.revokeShortfallMicro, 0n);
    await assert.rejects(
      () => wallet.reserve({
        requestId: "claw-release-again",
        walletId: granted.walletId,
        estimateMicro: 800n,
        productCode: "dataluminary",
        capability: "chat.text",
      }),
      (error) => error.code === "INSUFFICIENT_CREDITS",
    );
    const recon = await wallet.reconciliation(granted.walletId);
    assert.equal(recon.remainingMicro, 0n);
    assert.equal(recon.activeHoldMicro, 0n);
    assert.equal(recon.settledMicro, 0n);
    assert.equal(recon.revokedMicro, 1000n);
    assert.equal(
      recon.grantedMicro,
      recon.remainingMicro + recon.activeHoldMicro + recon.settledMicro + recon.revokedMicro,
    );
    const ledger = await app.get(DataSource).query(
      `SELECT meta FROM ledger_entries
       WHERE request_id = $1 AND kind = 'refund_reversal'`,
      ["claw-release-hold"],
    );
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].meta.fromHoldRelease, true);
  });

  test("partial settle after revoke claws the unused hold back instead of restoring it", async () => {
    const { WalletService } = await import("../dist/wallet/wallet.service.js");
    const wallet = app.get(WalletService);
    const granted = await wallet.grantCredits(grantInput("user", "user-claw-settle", 1000n, "ord-claw-settle"));
    await wallet.reserve({
      requestId: "claw-settle-hold",
      walletId: granted.walletId,
      estimateMicro: 800n,
      productCode: "dataluminary",
      capability: "chat.text",
    });
    await wallet.revokeBySource("order", "ord-claw-settle");
    const settled = await wallet.settle({
      requestId: "claw-settle-hold",
      capability: "chat.text",
      providerType: "openai",
      model: "fixture-model",
      usage: { promptTokens: 300, completionTokens: 0 },
    });
    assert.equal(settled.chargedMicro, 300n);
    const [grant] = await wallet.listGrants(granted.walletId);
    assert.equal(grant.remainingMicro, 0n);
    assert.equal(grant.revokedMicro, 700n);
    assert.equal(grant.revokeShortfallMicro, 300n);
    await assert.rejects(
      () => wallet.reserve({
        requestId: "claw-settle-again",
        walletId: granted.walletId,
        estimateMicro: 300n,
        productCode: "dataluminary",
        capability: "chat.text",
      }),
      (error) => error.code === "INSUFFICIENT_CREDITS",
    );
    const recon = await wallet.reconciliation(granted.walletId);
    assert.equal(recon.settledMicro, 300n);
    assert.equal(recon.revokedMicro, 700n);
    assert.equal(recon.activeHoldMicro, 0n);
    assert.equal(
      recon.grantedMicro,
      recon.remainingMicro + recon.activeHoldMicro + recon.settledMicro + recon.revokedMicro,
    );
  });

  test("reusing a requestId with a different product or capability conflicts", async () => {
    const { WalletService } = await import("../dist/wallet/wallet.service.js");
    const wallet = app.get(WalletService);
    const granted = await wallet.grantCredits(grantInput("user", "user-replay-scope", 500n, "ord-replay-scope"));
    await wallet.reserve({
      requestId: "replay-scope",
      walletId: granted.walletId,
      estimateMicro: 100n,
      productCode: "dataluminary",
      capability: "chat.text",
    });
    await assert.rejects(
      () => wallet.reserve({
        requestId: "replay-scope",
        walletId: granted.walletId,
        estimateMicro: 100n,
        productCode: "blockyedu",
        capability: "chat.text",
      }),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    await assert.rejects(
      () => wallet.reserve({
        requestId: "replay-scope",
        walletId: granted.walletId,
        estimateMicro: 100n,
        productCode: "dataluminary",
        capability: "stt",
      }),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    const recon = await wallet.reconciliation(granted.walletId);
    assert.equal(recon.remainingMicro, 400n);
    assert.equal(recon.activeHoldMicro, 100n);
  });

  test("serial and concurrent reserve cannot make the balance negative", async () => {
    const { WalletService } = await import("../dist/wallet/wallet.service.js");
    const wallet = app.get(WalletService);
    const serial = await wallet.grantCredits(grantInput("user", "user-serial", 1000n, "serial-grant"));
    await wallet.reserve({
      requestId: "serial-1",
      walletId: serial.walletId,
      estimateMicro: 600n,
      productCode: "dataluminary",
      capability: "chat.text",
    });
    await assert.rejects(
      () => wallet.reserve({
        requestId: "serial-2",
        walletId: serial.walletId,
        estimateMicro: 600n,
        productCode: "dataluminary",
        capability: "chat.text",
      }),
      (error) => error.code === "INSUFFICIENT_CREDITS",
    );
    const replay = await wallet.reserve({
      requestId: "serial-1",
      walletId: serial.walletId,
      estimateMicro: 600n,
      productCode: "dataluminary",
      capability: "chat.text",
    });
    assert.equal(replay.created, false);
    let recon = await wallet.reconciliation(serial.walletId);
    assert.equal(recon.remainingMicro, 400n);
    assert.equal(recon.activeHoldMicro, 600n);
    assert.equal(recon.grantedMicro, recon.remainingMicro + recon.activeHoldMicro + recon.settledMicro);

    const concurrent = await wallet.grantCredits(grantInput("user", "user-concurrent", 1000n, "concurrent-grant"));
    const results = await Promise.allSettled([
      wallet.reserve({
        requestId: "concurrent-1",
        walletId: concurrent.walletId,
        estimateMicro: 800n,
        productCode: "dataluminary",
        capability: "chat.text",
      }),
      wallet.reserve({
        requestId: "concurrent-2",
        walletId: concurrent.walletId,
        estimateMicro: 800n,
        productCode: "dataluminary",
        capability: "chat.text",
      }),
    ]);
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
    const denied = results.find((row) => row.status === "rejected");
    assert.equal(denied.reason.code, "INSUFFICIENT_CREDITS");
    recon = await wallet.reconciliation(concurrent.walletId);
    assert.equal(recon.remainingMicro, 200n);
    assert.equal(recon.activeHoldMicro, 800n);
    assert.ok(recon.remainingMicro >= 0n);
    const { DataSource } = await import("typeorm");
    const negative = await app.get(DataSource).query(
      `SELECT grant_id FROM credit_grants WHERE wallet_id = $1 AND remaining_micro < 0`,
      [concurrent.walletId],
    );
    assert.equal(negative.length, 0);
  });

  test("expired holds are released by the sweeper", async () => {
    const { WalletService } = await import("../dist/wallet/wallet.service.js");
    const { DataSource } = await import("typeorm");
    const wallet = app.get(WalletService);
    const granted = await wallet.grantCredits(grantInput("user", "user-expire", 900n, "expire-grant"));
    await wallet.reserve({
      requestId: "expire-me",
      walletId: granted.walletId,
      estimateMicro: 500n,
      productCode: "dataluminary",
      capability: "chat.text",
    });
    await app.get(DataSource).query(
      `UPDATE credit_holds SET expires_at = now() - interval '1 minute' WHERE request_id = $1`,
      ["expire-me"],
    );
    const swept = await wallet.releaseExpiredHolds(new Date());
    assert.equal(swept.released, 1);
    const again = await wallet.releaseExpiredHolds(new Date());
    assert.equal(again.released, 0);
    const recon = await wallet.reconciliation(granted.walletId);
    assert.equal(recon.remainingMicro, 900n);
    assert.equal(recon.activeHoldMicro, 0n);
    const rows = await app.get(DataSource).query(
      `SELECT status FROM credit_holds WHERE request_id = $1`,
      ["expire-me"],
    );
    assert.equal(rows[0].status, "expired");
    const ledger = await app.get(DataSource).query(
      `SELECT kind FROM ledger_entries WHERE request_id = $1 AND kind = 'expire'`,
      ["expire-me"],
    );
    assert.equal(ledger.length, 1);
  });

  test("ledger entries reject update and delete", async () => {
    const { DataSource } = await import("typeorm");
    const ds = app.get(DataSource);
    await assert.rejects(() => ds.query(`UPDATE ledger_entries SET amount_micro = 0`));
    await assert.rejects(() => ds.query(`DELETE FROM ledger_entries`));
    await assert.rejects(() => ds.query(`UPDATE rate_cards SET version = version`));
  });

  test("rate card versions only increase", async () => {
    const { WalletService } = await import("../dist/wallet/wallet.service.js");
    const wallet = app.get(WalletService);
    await assert.rejects(
      () => wallet.publishRateCard({
        id: "fixture",
        version: 1,
        effectiveFrom: new Date(),
        lines: [line("chat.text", "1k_input_tokens")],
      }),
      (error) => error.code === "VALIDATION_ERROR",
    );
    const published = await wallet.publishRateCard({
      id: "fixture",
      version: 2,
      effectiveFrom: new Date(),
      lines: [line("chat.text", "1k_input_tokens"), line("chat.text", "1k_output_tokens"), line("stt", "audio_second_in"), line("tts", "audio_second_out")],
    });
    assert.equal(published.version, 2);
    const quote = await wallet.quote({
      capability: "chat.text",
      providerType: "openai",
      model: "fixture-model",
      usage: { promptTokens: 1, completionTokens: 0 },
    });
    assert.equal(quote.rateCardVersion, 2);
    assert.equal(quote.chargedMicro, 1n);
  });

  test("wallet enforce rejects an insufficient hosted call and settles a funded one", async () => {
    const beforeMock = mockHits;
    const poor = await hit("POST", "/v1/chat/complete", {
      headers: service(KEY_A),
      body: hostedBody("dataluminary", "org-poor", "idem-poor"),
    });
    assert.equal(poor.status, 402);
    assert.equal(poor.json.error.code, "INSUFFICIENT_CREDITS");
    assert.equal(mockHits, beforeMock);

    const rich = await hit("POST", "/v1/chat/complete", {
      headers: service(KEY_A),
      body: hostedBody("dataluminary", "org-rich", "idem-rich"),
    });
    assert.equal(rich.status, 201, rich.text);
    assert.equal(rich.json.text, "ok");
    assert.equal(mockHits, beforeMock + 1);

    const { DataSource } = await import("typeorm");
    const holds = await app.get(DataSource).query(
      `SELECT status, settled_micro FROM credit_holds WHERE request_id = $1`,
      ["idem-rich"],
    );
    assert.equal(holds[0].status, "settled");
    assert.equal(Number(holds[0].settled_micro), 2);
    const poorHolds = await app.get(DataSource).query(
      `SELECT hold_id FROM credit_holds WHERE request_id = $1`,
      ["idem-poor"],
    );
    assert.equal(poorHolds.length, 0);
  });

  test("BYOK does not reserve credits", async () => {
    const before = mockHits;
    const byok = await hit("POST", "/v1/chat/complete", {
      headers: service(KEY_A),
      body: {
        connectionUid: byokUid,
        messages: [{ role: "user", content: "hi" }],
        productCode: "dataluminary",
        subjectId: "subj-byok",
        organizationId: "org-rich",
        feature: "ai.denied",
        maxTokens: 8,
        idempotencyKey: "idem-byok",
      },
    });
    assert.equal(byok.status, 201, byok.text);
    assert.equal(mockHits, before + 1);
    const { DataSource } = await import("typeorm");
    const holds = await app.get(DataSource).query(
      `SELECT hold_id FROM credit_holds WHERE request_id = $1`,
      ["idem-byok"],
    );
    assert.equal(holds.length, 0);
    const usage = await app.get(DataSource).query(
      `SELECT billed, charged_micro FROM ai_usage_events WHERE trace_id = $1`,
      [byok.json.traceId],
    );
    assert.equal(usage[0].billed, "byok");
    assert.equal(usage[0].charged_micro, null);
  });

  test("user JWT BYOK does not reserve credits and cannot call a hosted connection", async () => {
    const headers = { authorization: `Bearer ${await userToken("user-byok", "org-rich")}` };
    const hosted = await hit("POST", "/v1/chat/complete", {
      headers,
      body: {
        connectionUid: hostedUid,
        messages: [{ role: "user", content: "hi" }],
        productCode: "dataluminary",
        maxTokens: 8,
        idempotencyKey: "idem-user-hosted",
      },
    });
    assert.equal(hosted.status, 403);
    assert.equal(hosted.json.error.code, "FORBIDDEN");

    const before = mockHits;
    const byok = await hit("POST", "/v1/chat/complete", {
      headers,
      body: {
        connectionUid: byokUid,
        messages: [{ role: "user", content: "hi" }],
        productCode: "dataluminary",
        maxTokens: 8,
        idempotencyKey: "idem-user-byok",
      },
    });
    assert.equal(byok.status, 201, byok.text);
    assert.equal(mockHits, before + 1);
    const { DataSource } = await import("typeorm");
    const ds = app.get(DataSource);
    const holds = await ds.query(`SELECT hold_id FROM credit_holds WHERE request_id = $1`, ["idem-user-byok"]);
    assert.equal(holds.length, 0);
    const hostedHolds = await ds.query(`SELECT hold_id FROM credit_holds WHERE request_id = $1`, [
      "idem-user-hosted",
    ]);
    assert.equal(hostedHolds.length, 0);
    const usage = await ds.query(`SELECT billed, charged_micro FROM ai_usage_events WHERE trace_id = $1`, [
      byok.json.traceId,
    ]);
    assert.equal(usage[0].billed, "byok");
    assert.equal(usage[0].charged_micro, null);
  });

  test("hosted stream, transcribe, and synthesize settle when enforce is on", async () => {
    const stream = await hit("POST", "/v1/chat/stream", {
      headers: service(KEY_A),
      body: hostedBody("dataluminary", "org-rich", "idem-stream"),
    });
    assert.equal(stream.status, 200, stream.text);
    assert.match(stream.text, /"type":"done"/);

    const audio = Buffer.from("hello-audio").toString("base64");
    const stt = await hit("POST", "/v1/audio/transcribe", {
      headers: service(KEY_A),
      body: {
        connectionUid: hostedUid,
        audioBase64: audio,
        productCode: "dataluminary",
        subjectId: "subj-stt",
        organizationId: "org-rich",
        feature: "ai.analysis",
        idempotencyKey: "idem-stt",
        capability: "stt",
      },
    });
    assert.equal(stt.status, 201, stt.text);
    assert.equal(stt.json.text, "hello from fixture");

    const tts = await hit("POST", "/v1/audio/synthesize", {
      headers: service(KEY_A),
      body: {
        connectionUid: hostedUid,
        text: "hello",
        productCode: "dataluminary",
        subjectId: "subj-tts",
        organizationId: "org-rich",
        feature: "ai.analysis",
        idempotencyKey: "idem-tts",
        capability: "tts",
      },
    });
    assert.equal(tts.status, 201, tts.text);
    assert.equal(typeof tts.json.audioBase64, "string");

    const { DataSource } = await import("typeorm");
    const holds = await app.get(DataSource).query(
      `SELECT request_id, status, settled_micro FROM credit_holds WHERE request_id = ANY($1::varchar[]) ORDER BY request_id`,
      [["idem-stream", "idem-stt", "idem-tts"]],
    );
    assert.equal(holds.length, 3);
    assert.equal(holds.every((row) => row.status === "settled" && Number(row.settled_micro) > 0), true);
  });
});

function line(capability, unit) {
  return {
    capability,
    providerType: "openai",
    model: "fixture-model",
    unit,
    upstreamCostMicroUsd: 1000n,
    markupBps: 0,
    fixedFeeMicro: 0n,
  };
}

function grantInput(ownerKind, ownerId, amountMicro, sourceId) {
  return {
    ownerKind,
    ownerId,
    currency: "USD",
    kind: "topup",
    amountMicro,
    sourceType: "order",
    sourceId,
  };
}

function remaining(grants, sourceId) {
  const row = grants.find((grant) => grant.sourceId === sourceId);
  if (!row) throw new Error(`missing grant ${sourceId}`);
  return row.remainingMicro;
}

function service(key) {
  return { "x-service-key": key };
}

function v2Body(productCode, overrides = {}) {
  return {
    capability: "chat.text",
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 16,
    productCode,
    subjectId: "stu-1",
    idempotencyKey: "idem-v2-a",
    ...overrides,
  };
}

function hostedBody(productCode, organizationId, idempotencyKey, overrides = {}) {
  return {
    connectionUid: hostedUid,
    messages: [{ role: "user", content: "hi" }],
    productCode,
    subjectId: "subj-hosted",
    organizationId,
    feature: "ai.analysis",
    maxTokens: 8,
    idempotencyKey,
    ...overrides,
  };
}

function userToken(sub, org) {
  return new SignJWT({ sub, org_id: org })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("5m")
    .sign(privateKey);
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

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
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
