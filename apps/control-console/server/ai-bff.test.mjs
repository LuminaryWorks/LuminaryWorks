import assert from "node:assert/strict";
import { createServer as createHttp } from "node:http";
import { after, before, describe, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createServer } from "./main.mjs";

const SERVICE_KEY = "ai-platform-internal-key-0123456789";
const AUDIENCE = "https://entitlement.luminaryworks.dev";

let issuer;
let privateKey;
let jwksServer;
let upstream;
let hits;
let app;

describe("AI BFF", { concurrency: 1 }, () => {
  before(async () => {
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = "cc-test";
    jwk.alg = "RS256";
    jwk.use = "sig";
    jwksServer = createHttp((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await listen(jwksServer);
    issuer = `http://127.0.0.1:${jwksServer.address().port}/oidc`;

    hits = [];
    upstream = createHttp((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        hits.push({
          method: req.method,
          url: req.url,
          serviceKey: req.headers["x-service-key"],
          subject: req.headers["x-service-subject"],
          body: raw,
        });
        res.setHeader("content-type", "application/json");
        res.setHeader(
          "x-service-key",
          String(req.headers["x-service-key"] || ""),
        );
        res.end(
          JSON.stringify({
            ok: true,
            echoed: req.headers["x-service-key"],
            secret: "do-not-show",
            items: [],
            body: raw ? JSON.parse(raw) : null,
          }),
        );
      });
    });
    await listen(upstream);

    const started = createServer({
      CONTROL_CONSOLE_IDP_ISSUER: issuer,
      CONTROL_CONSOLE_IDP_CLIENT_ID: "spa-client",
      CONTROL_CONSOLE_IDP_AUDIENCE: AUDIENCE,
      CONTROL_CONSOLE_PUBLIC_URL: "http://127.0.0.1:3050",
      AI_PLATFORM_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
      AI_PLATFORM_INTERNAL_SERVICE_KEY: SERVICE_KEY,
    });
    app = started.app;
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    if (upstream) await close(upstream);
    if (jwksServer) await close(jwksServer);
  });

  test("missing and invalid tokens are 401 and do not call upstream", async () => {
    const beforeHits = hits.length;
    const missing = await app.inject({
      method: "GET",
      url: "/bff/ai/settings",
    });
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json().error.code, "UNAUTHORIZED");
    const bad = await app.inject({
      method: "GET",
      url: "/bff/ai/settings",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    assert.equal(bad.statusCode, 401);
    assert.equal(hits.length, beforeHits);
  });

  test("wrong scope is 403 and does not call upstream", async () => {
    const beforeHits = hits.length;
    const token = await sign("openid profile");
    const res = await app.inject({
      method: "GET",
      url: "/bff/ai/settings",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, "FORBIDDEN");
    assert.equal(hits.length, beforeHits);
  });

  test("admin scope proxies with the service key and never returns it", async () => {
    const token = await sign("openid entitlement:admin");
    const res = await app.inject({
      method: "GET",
      url: "/bff/ai/settings",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200, res.body);
    const raw = `${res.body}\n${JSON.stringify(res.headers)}`;
    assert.equal(raw.includes(SERVICE_KEY), false);
    assert.equal(raw.includes("do-not-show"), false);
    assert.equal(res.json().echoed, "[redacted]");
    assert.equal(res.json().secret, undefined);
    assert.equal(hits.at(-1).serviceKey, SERVICE_KEY);
    assert.equal(hits.at(-1).subject, "operator-1");

    const aiAdmin = await sign("ai:admin");
    const again = await app.inject({
      method: "GET",
      url: "/bff/ai/connections",
      headers: { authorization: `Bearer ${aiAdmin}` },
    });
    assert.equal(again.statusCode, 200);
    assert.equal(
      `${again.body}${JSON.stringify(again.headers)}`.includes(SERVICE_KEY),
      false,
    );
  });

  test("manual grant uses promo, an admin order id, and drops the reason", async () => {
    const token = await sign("openid entitlement:admin");
    const res = await app.inject({
      method: "POST",
      url: "/bff/ai/wallets/grant",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        ownerKind: "user",
        ownerId: "user-1",
        amountMicro: 2500,
        expiresAt: "2026-12-01T00:00:00.000Z",
        reason: "goodwill",
        currency: "USD",
      }),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.body.includes(SERVICE_KEY), false);
    const sent = JSON.parse(hits.at(-1).body);
    assert.equal(sent.kind, "promo");
    assert.match(sent.orderId, /^admin:/);
    assert.equal(sent.reason, undefined);
    assert.equal(sent.walletOwner.kind, "user");
    assert.equal(sent.amountMicro, 2500);
  });

  test("config and health do not contain the service key", async () => {
    const cfg = await app.inject({ method: "GET", url: "/config.json" });
    assert.equal(cfg.statusCode, 200);
    assert.equal(cfg.body.includes(SERVICE_KEY), false);
    assert.equal(cfg.body.includes("AI_PLATFORM"), false);
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.body.includes(SERVICE_KEY), false);
  });
});

function sign(scope) {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", kid: "cc-test" })
    .setSubject("operator-1")
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setExpirationTime("5m")
    .sign(privateKey);
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
