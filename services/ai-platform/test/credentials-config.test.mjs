import assert from "node:assert/strict";
import test from "node:test";
import { loadAiPlatformConfig } from "../dist/config/ai-platform.config.js";

const oidc = {
  NODE_ENV: "production",
  AI_PLATFORM_AUTH_MODE: "oidc",
  AI_PLATFORM_OIDC_ISSUER: "https://id.example.test/oidc",
  AI_PLATFORM_OIDC_AUDIENCE: "https://ai.luminaryworks.dev",
  AI_PLATFORM_JWKS_URI: "https://id.example.test/oidc/jwks",
};

test("single service key is bound to comma-separated product codes", () => {
  const config = loadAiPlatformConfig({
    ...oidc,
    AI_PLATFORM_SERVICE_API_KEY: "service-key-0123456789",
    AI_PLATFORM_SERVICE_PRODUCT_CODES: "dataluminary, blockyedu,dataluminary",
  });
  assert.equal(config.serviceCredentials.length, 1);
  assert.deepEqual(config.serviceCredentials[0].productCodes, ["dataluminary", "blockyedu"]);
  assert.equal(config.serviceCredentials[0].internal, false);
});

test("JSON credentials add keys and internal scope", () => {
  const config = loadAiPlatformConfig({
    ...oidc,
    AI_PLATFORM_SERVICE_API_KEY: "service-key-0123456789",
    AI_PLATFORM_SERVICE_PRODUCT_CODES: "dataluminary",
    AI_PLATFORM_SERVICE_CREDENTIALS_JSON: JSON.stringify([
      { key: "credential-b-0123456789", productCodes: ["blockyedu"] },
      { key: "credential-internal-01", productCodes: [], internal: true },
    ]),
  });
  assert.equal(config.serviceCredentials.length, 3);
  assert.equal(config.serviceCredentials[1].productCodes[0], "blockyedu");
  assert.equal(config.serviceCredentials[2].internal, true);
});

test("production rejects a credential that cannot name a product", () => {
  assert.throws(
    () =>
      loadAiPlatformConfig({
        ...oidc,
        AI_PLATFORM_SERVICE_API_KEY: "service-key-0123456789",
      }),
    /productCodes/,
  );
  assert.throws(
    () =>
      loadAiPlatformConfig({
        ...oidc,
        AI_PLATFORM_SERVICE_API_KEY: "short-key",
        AI_PLATFORM_SERVICE_PRODUCT_CODES: "dataluminary",
      }),
    /at least 16 characters/,
  );
  assert.throws(
    () =>
      loadAiPlatformConfig({
        ...oidc,
        AI_PLATFORM_SERVICE_CREDENTIALS_JSON: "{",
        AI_PLATFORM_SERVICE_API_KEY: "service-key-0123456789",
        AI_PLATFORM_SERVICE_PRODUCT_CODES: "dataluminary",
      }),
    /not valid JSON/,
  );
  assert.throws(
    () =>
      loadAiPlatformConfig({
        ...oidc,
        AI_PLATFORM_SERVICE_API_KEY: "service-key-0123456789",
        AI_PLATFORM_SERVICE_PRODUCT_CODES: "dataluminary",
        AI_PLATFORM_SERVICE_CREDENTIALS_JSON: JSON.stringify([
          { key: "service-key-0123456789", productCodes: ["blockyedu"] },
        ]),
      }),
    /duplicate service credential/,
  );
});
