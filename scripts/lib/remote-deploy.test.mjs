import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseDotEnv,
} from "../init-scenario-env.mjs";
import {
  assertObjectStorageRemotePreflight,
  objectStorageProfileRequested,
  probeUrls,
  publicBaseUrl,
  renderControlPlaneEnv,
} from "./remote-deploy.mjs";

const example = `# comment
CONTROL_PLANE_BIND_ADDR=127.0.0.1
CONTROL_PLANE_ADMIN_BIND_ADDR=127.0.0.1
IDENTITY_ENDPOINT=http://localhost:3001
IDENTITY_ADMIN_ENDPOINT=http://localhost:3002
AUTH_GATEWAY_PUBLIC_URL=http://localhost:3010
ENTITLEMENT_OIDC_ISSUER=http://identity:3001/oidc
IDENTITY_DB_PASSWORD=
ENTITLEMENT_DB_PASSWORD=
ENTITLEMENT_SERVICE_API_KEY=
ENTITLEMENT_PARTNER_SECRET_PEPPER=
ENTITLEMENT_PARTNER_TOKEN_SECRET=
AI_VAULT_MASTER_KEY=
ENTITLEMENT_GIT_SHA=
POSTGRES_IMAGE=postgres:16-alpine
`;

test("publicBaseUrl accepts host or URL", () => {
  assert.equal(publicBaseUrl("192.168.64.3"), "http://192.168.64.3");
  assert.equal(publicBaseUrl("https://id.example.com/"), "https://id.example.com");
});

test("renderControlPlaneEnv fills LAN URLs and secrets once", () => {
  let n = 0;
  const text = renderControlPlaneEnv(example, {
    publicHost: "192.168.64.3",
    bindAddr: "0.0.0.0",
    generateSecret: () => `sec${n++}`,
    gitSha: "abc123",
  });
  const env = parseDotEnv(text);
  assert.equal(env.CONTROL_PLANE_BIND_ADDR, "0.0.0.0");
  assert.equal(env.IDENTITY_ENDPOINT, "http://192.168.64.3:3001");
  assert.equal(env.IDENTITY_ADMIN_ENDPOINT, "http://127.0.0.1:3002");
  assert.equal(env.AUTH_GATEWAY_PUBLIC_URL, "http://192.168.64.3:3010");
  assert.equal(env.ENTITLEMENT_OIDC_ISSUER, "http://192.168.64.3:3001/oidc");
  assert.equal(env.IDENTITY_DB_PASSWORD, "sec0");
  assert.equal(env.AI_VAULT_MASTER_KEY, "sec5");
  assert.equal(env.ENTITLEMENT_GIT_SHA, "abc123");
  assert.equal(env.POSTGRES_IMAGE, "postgres:16-alpine");
  assert.match(text, /^# comment$/m);
});

test("renderControlPlaneEnv keeps existing secrets", () => {
  const first = renderControlPlaneEnv(example, {
    publicHost: "192.168.64.3",
    generateSecret: () => "keep-me",
  });
  const second = renderControlPlaneEnv(example, {
    publicHost: "10.0.0.8",
    existingText: first,
    generateSecret: () => "new-secret",
  });
  const env = parseDotEnv(second);
  assert.equal(env.IDENTITY_DB_PASSWORD, "keep-me");
  assert.equal(env.IDENTITY_ENDPOINT, "http://10.0.0.8:3001");
});

test("probeUrls expose control-plane contracts on the public host", () => {
  const urls = probeUrls("192.168.64.3");
  assert.equal(
    urls.find((item) => item.name === "identity-oidc-discovery").url,
    "http://192.168.64.3:3001/oidc/.well-known/openid-configuration",
  );
  assert.equal(urls.find((item) => item.name === "entitlement-ready").url, "http://192.168.64.3:3040/ready");
  assert.equal(urls.find((item) => item.name === "control-console-health").url, "http://192.168.64.3:3050/health");
});

test("object-storage profile stays off unless explicitly enabled", () => {
  assert.equal(objectStorageProfileRequested({}), false);
  assert.equal(objectStorageProfileRequested({ OBJECT_STORAGE_ENABLED: "0" }), false);
  assert.equal(objectStorageProfileRequested({ OBJECT_STORAGE_ENABLED: "1" }), true);
  const skipped = assertObjectStorageRemotePreflight({ OBJECT_STORAGE_ENABLED: "0" });
  assert.equal(skipped.ok, true);
  assert.throws(
    () => assertObjectStorageRemotePreflight({ OBJECT_STORAGE_ENABLED: "1" }),
    /license, pinned AIStor image, root, and per-product secrets/,
  );
});

test("renderControlPlaneEnv does not invent AIStor root or product secrets", () => {
  const withStorage = `${example}
OBJECT_STORAGE_ENABLED=0
AISTOR_ROOT_USER=
AISTOR_ROOT_PASSWORD=
AISTOR_DATALUMINARY_ACCESS_KEY=
`;
  const text = renderControlPlaneEnv(withStorage, {
    publicHost: "192.168.64.3",
    generateSecret: () => "sec",
  });
  const env = parseDotEnv(text);
  assert.equal(env.OBJECT_STORAGE_ENABLED, "0");
  assert.equal(env.AISTOR_ROOT_PASSWORD, "");
  assert.equal(env.AISTOR_DATALUMINARY_ACCESS_KEY, "");
});
