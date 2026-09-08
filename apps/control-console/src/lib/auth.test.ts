import { describe, expect, it } from "vitest";
import { CALLBACK_PATH, isCallbackPath, toIdpConfig } from "./auth";
import type { RuntimeConfig } from "./runtime-config";

const runtime: RuntimeConfig = {
  issuer: "http://localhost:3001/oidc",
  clientId: "control-console",
  audience: "https://entitlement.luminaryworks.dev",
  entitlementBaseUrl: "http://localhost:3040",
  experienceApiBase: "http://localhost:3050",
  redirectUri: "",
  postLogoutRedirectUri: "",
  scopes: "openid profile entitlement:admin",
  iamProvider: "logto",
  legalDocsUrl: "",
  legalPolicyVersion: "",
  capacity: { dorisPilotUrl: "", objectStorageUrl: "" },
};

describe("auth config and callback path", () => {
  it("uses /auth/callback on the console origin", () => {
    expect(isCallbackPath("/auth/callback")).toBe(true);
    expect(isCallbackPath("/login")).toBe(false);
    expect(CALLBACK_PATH).toBe("/auth/callback");
    const cfg = toIdpConfig(runtime, "http://localhost:3050");
    expect(cfg?.redirectUri).toBe("http://localhost:3050/auth/callback");
    expect(cfg?.clientId).toBe("control-console");
    expect(cfg?.audience).toBe("https://entitlement.luminaryworks.dev");
  });

  it("returns null when clientId is missing (no invented SPA)", () => {
    expect(
      toIdpConfig({ ...runtime, clientId: "" }, "http://localhost:3050"),
    ).toBeNull();
  });
});
