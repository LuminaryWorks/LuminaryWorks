import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "./main.mjs";

test("production server health, version, ready, and config", async () => {
  const env = {
    ACCOUNT_CENTER_PORT: "0",
    ACCOUNT_CENTER_IDP_ISSUER: "http://localhost:3001/oidc",
    ACCOUNT_CENTER_IDP_CLIENT_ID: "spa-client",
    ACCOUNT_CENTER_PUBLIC_URL: "http://localhost:3060",
    ACCOUNT_CENTER_AI_BASE_URL: "http://127.0.0.1:13100",
    ACCOUNT_CENTER_ENTITLEMENT_BASE_URL: "http://127.0.0.1:3040",
    ACCOUNT_CENTER_APPS_JSON: "[]",
  };
  const { app } = createServer(env);
  await app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().status, "ok");
    const version = await app.inject({ method: "GET", url: "/version" });
    assert.equal(version.json().service, "luminary-account-center");
    const cfg = await app.inject({ method: "GET", url: "/config.json" });
    assert.equal(cfg.statusCode, 200);
    const body = cfg.json();
    assert.equal(body.clientId, "spa-client");
    assert.equal(body.audience, "https://ai.luminaryworks.dev");
    assert.equal(body.clientSecret, undefined);
    assert.deepEqual(body.apps, []);
    const ready = await app.inject({ method: "GET", url: "/ready" });
    assert.ok(ready.statusCode === 200 || ready.statusCode === 503);
  } finally {
    await app.close();
  }
});
