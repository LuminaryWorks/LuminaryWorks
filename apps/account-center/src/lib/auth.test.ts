import { describe, expect, it } from "@rstest/core";
import { CALLBACK_PATH, isCallbackPath, toIdpConfig } from "./auth";
import type { RuntimeConfig } from "./runtime-config";

const runtime: RuntimeConfig = {
  issuer: "http://localhost:3001/oidc",
  clientId: "account-center",
  audience: "https://ai.luminaryworks.dev",
  aiPlatformBaseUrl: "http://127.0.0.1:13100",
  entitlementBaseUrl: "http://127.0.0.1:3040",
  experienceApiBase: "http://localhost:3060",
  redirectUri: "",
  postLogoutRedirectUri: "",
  scopes: "openid profile email",
  iamProvider: "logto",
  accountUrl: "http://localhost:3001",
  securityUrl: "http://localhost:3001",
  apps: [],
};

describe("auth config", () => {
  it("uses /auth/callback and the AI audience", () => {
    expect(isCallbackPath("/auth/callback")).toBe(true);
    expect(isCallbackPath("/login")).toBe(false);
    expect(CALLBACK_PATH).toBe("/auth/callback");
    const cfg = toIdpConfig(runtime, "http://localhost:3060");
    expect(cfg?.redirectUri).toBe("http://localhost:3060/auth/callback");
    expect(cfg?.audience).toBe("https://ai.luminaryworks.dev");
    expect(cfg?.clientId).toBe("account-center");
  });

  it("returns null when the public client id is missing", () => {
    expect(
      toIdpConfig({ ...runtime, clientId: "" }, "http://localhost:3060"),
    ).toBeNull();
  });
});
