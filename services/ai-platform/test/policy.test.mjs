import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  entitlementCacheKey,
  ephemeralSecretAllowed,
  isByokPath,
  allowPrivateBaseUrls,
  readCorsOrigins,
  readPublicApiEnabled,
  readWalletEnforce,
  resolveIngress,
  vaultKeyUsable,
} from "../dist/policy.js";

test("public API switch defaults off and does not affect product routes", () => {
  assert.equal(readPublicApiEnabled({}), false);
  assert.equal(readPublicApiEnabled({ PUBLIC_API_ENABLED: "false" }), false);
  assert.equal(readPublicApiEnabled({ PUBLIC_API_ENABLED: "true" }), true);

  assert.equal(resolveIngress("/v1/providers", false), "product");
  assert.equal(resolveIngress("/v1/chat/complete", true), "product");
  assert.equal(resolveIngress("/v1/health", false), "open");
  assert.equal(resolveIngress("/ready", false), "open");
  assert.equal(resolveIngress("/v1/public/chat", false), "public-disabled");
  assert.equal(resolveIngress("/v1/public/chat", true), "public-unimplemented");
  assert.equal(resolveIngress("/v1/publicity", false), "product");
});

test("production business routes refuse ephemeral secrets", () => {
  assert.equal(
    ephemeralSecretAllowed({ production: true, allowEphemeral: false, hasSecret: true }),
    false,
  );
  assert.equal(
    ephemeralSecretAllowed({ production: true, allowEphemeral: true, hasSecret: true }),
    true,
  );
  assert.equal(
    ephemeralSecretAllowed({ production: false, allowEphemeral: false, hasSecret: true }),
    true,
  );
});

test("BYOK skips hosted entitlement and deployment keys do not", () => {
  assert.equal(isByokPath({ ephemeral: true, providerType: "openai", ownerKind: null }), true);
  assert.equal(isByokPath({ ephemeral: false, providerType: "openai", ownerKind: "user" }), true);
  assert.equal(isByokPath({ ephemeral: false, providerType: "openai", ownerKind: "space" }), true);
  assert.equal(
    isByokPath({ ephemeral: false, providerType: "deepseek", ownerKind: "organization" }),
    true,
  );
  assert.equal(
    isByokPath({ ephemeral: false, providerType: "openai", ownerKind: "deployment" }),
    false,
  );
  assert.equal(
    isByokPath({ ephemeral: false, providerType: "luminary-managed", ownerKind: "user" }),
    false,
  );
});

test("entitlement cache key contains subjectId and feature", () => {
  const key = entitlementCacheKey("user-1", "ai.analysis", "dataluminary");
  assert.equal(key, "user-1+ai.analysis+dataluminary");
  assert.match(key, /user-1\+ai\.analysis/);
});

test("private base URLs and browser CORS default closed", () => {
  assert.equal(allowPrivateBaseUrls({}), false);
  assert.equal(allowPrivateBaseUrls({ AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS: "true" }), true);
  assert.equal(allowPrivateBaseUrls({ AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS: "false" }), false);
  assert.deepEqual(readCorsOrigins({}), []);
  assert.deepEqual(readCorsOrigins({ AI_PLATFORM_CORS_ORIGINS: "*" }), []);
  assert.deepEqual(
    readCorsOrigins({ AI_PLATFORM_CORS_ORIGINS: " http://localhost:3050, *,http://localhost:3050 " }),
    ["http://localhost:3050"],
  );
});

test("wallet enforce defaults off", () => {
  assert.equal(readWalletEnforce({}), false);
  assert.equal(readWalletEnforce({ AI_PLATFORM_WALLET_ENFORCE: "false" }), false);
  assert.equal(readWalletEnforce({ AI_PLATFORM_WALLET_ENFORCE: "true" }), true);
});

test("vault master key must be present and usable", () => {
  assert.equal(vaultKeyUsable(undefined), false);
  assert.equal(vaultKeyUsable("   "), false);
  assert.equal(vaultKeyUsable("ab".repeat(32)), true);
});

test("gateway no longer keeps usage or connections only in memory", () => {
  const source = readFileSync(new URL("../src/ai-gateway.service.ts", import.meta.url), "utf8");
  assert.equal(source.includes("usageLog"), false);
  assert.equal(source.includes("loadConnections"), false);
  assert.match(source, /this\.recordUsage\(/);
  assert.match(source, /this\.usage\.save\(/);
  assert.match(source, /encryptSecret\(/);
  assert.equal(source.includes('|| "unknown"'), false);
});
