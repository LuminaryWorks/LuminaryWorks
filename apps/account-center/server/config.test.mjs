import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRuntimeConfig,
  evaluateReadiness,
  optionalUrl,
  parseApps,
} from "./config.mjs";

test("runtime config requires issuer, publishes apps, and omits secrets", () => {
  const cfg = buildRuntimeConfig({
    ACCOUNT_CENTER_IDP_ISSUER: "http://localhost:3001/oidc",
    ACCOUNT_CENTER_IDP_CLIENT_ID: "spa-client",
    ACCOUNT_CENTER_PUBLIC_URL: "http://localhost:3060",
    ACCOUNT_CENTER_AI_BASE_URL: "http://127.0.0.1:13100",
    ACCOUNT_CENTER_ENTITLEMENT_BASE_URL: "http://127.0.0.1:3040",
    ACCOUNT_CENTER_IDP_AUDIENCE: "https://ai.luminaryworks.dev",
    ACCOUNT_CENTER_APPS_JSON: JSON.stringify([
      {
        code: "dataluminary",
        name: "DataLuminary",
        url: "https://data.example",
        description: "Insight",
      },
    ]),
  });
  assert.equal(cfg.issuer, "http://localhost:3001/oidc");
  assert.equal(cfg.clientId, "spa-client");
  assert.equal(cfg.audience, "https://ai.luminaryworks.dev");
  assert.equal(cfg.redirectUri, "http://localhost:3060/auth/callback");
  assert.equal(cfg.accountUrl, "http://localhost:3001");
  assert.equal(cfg.apps.length, 1);
  assert.equal(cfg.apps[0].code, "dataluminary");
  assert.equal("clientSecret" in cfg, false);
  const json = JSON.stringify(cfg);
  assert.equal(json.includes("secret"), false);
  assert.equal(json.includes("service"), false);
});

test("runtime config rejects secret-like keys and bad apps json", () => {
  assert.throws(
    () =>
      buildRuntimeConfig({
        ACCOUNT_CENTER_IDP_ISSUER: "http://localhost:3001/oidc",
        ACCOUNT_CENTER_IDP_CLIENT_SECRET: "nope",
      }),
    /secret-like/,
  );
  assert.throws(() => parseApps("{"), /JSON/);
  assert.throws(() => parseApps("{}"), /array/);
  assert.equal(optionalUrl("", "x"), "");
  assert.throws(() => optionalUrl("not-a-url", "x"), /absolute URL/);
});

test("readiness fails closed without dist or valid config", () => {
  const missingDist = evaluateReadiness({
    distExists: false,
    configError: "",
  });
  assert.equal(missingDist.statusCode, 503);
  const badCfg = evaluateReadiness({
    distExists: true,
    configError: "issuer required",
  });
  assert.equal(badCfg.statusCode, 503);
  const ok = evaluateReadiness({ distExists: true, configError: "" });
  assert.equal(ok.statusCode, 200);
});
