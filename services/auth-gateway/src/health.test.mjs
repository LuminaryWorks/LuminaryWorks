import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_GATEWAY_API_VERSION,
  AUTH_GATEWAY_SCHEMA_VERSION,
  buildHealthPayload,
  buildVersionPayload,
  checkUpstreamDiscovery,
  evaluateReadiness,
  HEALTH_PATHS,
  READY_PATHS,
} from "./health.mjs";

test("health is liveness only", () => {
  const payload = buildHealthPayload({
    publicIssuer: "http://localhost:3010/oidc",
    upstreamIssuer: "http://identity:3001/oidc",
  });
  assert.equal(payload.status, "ok");
  assert.equal(payload.service, "luminary-auth-gateway");
  assert.deepEqual(HEALTH_PATHS, ["/health", "/healthz"]);
});

test("version reports api, schema and git sha", () => {
  const payload = buildVersionPayload({
    version: "0.1.0",
    gitSha: " abc1234 ",
    publicIssuer: "http://localhost:3010/oidc",
    upstreamIssuer: "http://identity:3001/oidc",
  });
  assert.equal(payload.apiVersion, AUTH_GATEWAY_API_VERSION);
  assert.equal(payload.schemaVersion, AUTH_GATEWAY_SCHEMA_VERSION);
  assert.equal(payload.gitSha, "abc1234");
  assert.equal(buildVersionPayload({}).gitSha, "unknown");
});

test("ready returns 200 when every check is up or skipped", () => {
  const { statusCode, payload } = evaluateReadiness([
    { name: "upstream_issuer", status: "up" },
    { name: "cache", status: "skipped" },
  ]);
  assert.equal(statusCode, 200);
  assert.equal(payload.status, "ready");
  assert.deepEqual(READY_PATHS, ["/ready", "/readyz"]);
});

test("ready returns 503 and names the failed dependency", () => {
  const { statusCode, payload } = evaluateReadiness([
    { name: "upstream_issuer", status: "down", detail: "HTTP 502" },
  ]);
  assert.equal(statusCode, 503);
  assert.equal(payload.status, "not_ready");
  assert.deepEqual(payload.failed, ["upstream_issuer"]);
});

test("upstream discovery check reports up on 200", async () => {
  const calls = [];
  const check = await checkUpstreamDiscovery({
    upstreamIssuer: "http://identity:3001/oidc/",
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, status: 200 };
    },
  });
  assert.deepEqual(check, { name: "upstream_issuer", status: "up" });
  assert.deepEqual(calls, ["http://identity:3001/oidc/.well-known/openid-configuration"]);
});

test("upstream discovery check reports down on non-2xx and on network error", async () => {
  const httpError = await checkUpstreamDiscovery({
    upstreamIssuer: "http://identity:3001/oidc",
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(httpError.status, "down");
  assert.equal(httpError.detail, "HTTP 503");

  const networkError = await checkUpstreamDiscovery({
    upstreamIssuer: "http://identity:3001/oidc",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(networkError.status, "down");
  assert.equal(networkError.detail, "ECONNREFUSED");
});
