import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "./main.mjs";

test("production server health and config endpoints", async () => {
  const env = {
    CONTROL_CONSOLE_PORT: "0",
    CONTROL_CONSOLE_IDP_ISSUER: "http://localhost:3001/oidc",
    CONTROL_CONSOLE_IDP_CLIENT_ID: "spa-client",
    CONTROL_CONSOLE_PUBLIC_URL: "http://localhost:3050",
    CONTROL_CONSOLE_ENTITLEMENT_BASE_URL: "http://localhost:3040",
  };
  const { app } = createServer(env);
  await app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().status, "ok");
    const version = await app.inject({ method: "GET", url: "/version" });
    assert.equal(version.json().service, "luminary-control-console");
    const cfg = await app.inject({ method: "GET", url: "/config.json" });
    assert.equal(cfg.statusCode, 200);
    const body = cfg.json();
    assert.equal(body.clientId, "spa-client");
    assert.equal(body.clientSecret, undefined);
    const ready = await app.inject({ method: "GET", url: "/ready" });
    assert.ok(ready.statusCode === 200 || ready.statusCode === 503);
  } finally {
    await app.close();
  }
});
