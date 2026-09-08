import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRuntimeConfig,
  evaluateReadiness,
  optionalUrl,
} from "./config.mjs";

test("runtime config requires issuer and omits secrets", () => {
  const cfg = buildRuntimeConfig({
    CONTROL_CONSOLE_IDP_ISSUER: "http://localhost:3001/oidc",
    CONTROL_CONSOLE_IDP_CLIENT_ID: "spa-client",
    CONTROL_CONSOLE_PUBLIC_URL: "http://localhost:3050",
    CONTROL_CONSOLE_ENTITLEMENT_BASE_URL: "http://localhost:3040",
    CONTROL_CONSOLE_LEGAL_DOCS_URL: "https://docs.luminaryworks.dev/legal",
  });
  assert.equal(cfg.issuer, "http://localhost:3001/oidc");
  assert.equal(cfg.clientId, "spa-client");
  assert.equal(cfg.redirectUri, "http://localhost:3050/auth/callback");
  assert.equal(cfg.capacity.dorisPilotUrl, "");
  assert.equal(cfg.capacity.objectStorageUrl, "");
  assert.equal("clientSecret" in cfg, false);
  const json = JSON.stringify(cfg);
  assert.equal(json.includes("secret"), false);
  assert.equal(json.includes("service"), false);
});

test("runtime config rejects secret-like keys", () => {
  assert.throws(
    () =>
      buildRuntimeConfig({
        CONTROL_CONSOLE_IDP_ISSUER: "http://localhost:3001/oidc",
        CONTROL_CONSOLE_IDP_CLIENT_SECRET: "nope",
      }),
    /secret-like/,
  );
});

test("optional capacity URLs stay empty rather than invented", () => {
  assert.equal(optionalUrl("", "x"), "");
  assert.throws(() => optionalUrl("not-a-url", "x"), /absolute URL/);
});

test("readiness fails closed without dist or valid config", () => {
  const missingDist = evaluateReadiness({ distExists: false, configError: "" });
  assert.equal(missingDist.statusCode, 503);
  const badCfg = evaluateReadiness({
    distExists: true,
    configError: "issuer required",
  });
  assert.equal(badCfg.statusCode, 503);
  const ok = evaluateReadiness({ distExists: true, configError: "" });
  assert.equal(ok.statusCode, 200);
});
