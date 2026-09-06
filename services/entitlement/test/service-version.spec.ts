import {
  buildServiceVersionPayload,
  ENTITLEMENT_API_VERSION,
  ENTITLEMENT_SCHEMA_VERSION,
} from "../src/common/service-version";
import entitlementConfig from "../src/config/entitlement.config";

describe("GET /version payload", () => {
  it("declares the contract versions a Control Manifest can pin", () => {
    const payload = buildServiceVersionPayload({});
    expect(payload).toEqual({
      service: "luminary-entitlement",
      version: "0.2.0",
      apiVersion: ENTITLEMENT_API_VERSION,
      schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
      gitSha: "unknown",
    });
  });

  it("reports the build git sha when provided", () => {
    expect(buildServiceVersionPayload({ ENTITLEMENT_GIT_SHA: " abc1234 " }).gitSha).toBe("abc1234");
  });

  it("matches the contract versions supported by @luminaryworks/control-manifest", () => {
    // Keep in sync with SUPPORTED_CONTRACTS.entitlement in the shared package.
    expect(ENTITLEMENT_API_VERSION).toBe("v1");
    expect(ENTITLEMENT_SCHEMA_VERSION).toBe("1");
  });
});

describe("ENTITLEMENT_PORT freeze", () => {
  const original = process.env.ENTITLEMENT_PORT;

  afterEach(() => {
    if (original === undefined) delete process.env.ENTITLEMENT_PORT;
    else process.env.ENTITLEMENT_PORT = original;
  });

  it("defaults to 3040 and never 7090", () => {
    delete process.env.ENTITLEMENT_PORT;
    const cfg = entitlementConfig() as { port: number };
    expect(cfg.port).toBe(3040);
    expect(cfg.port).not.toBe(7090);
  });
});
