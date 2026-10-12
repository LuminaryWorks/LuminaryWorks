import { describe, expect, it } from "@rstest/core";
import {
  assertPublicRuntimeConfig,
  bindRedirects,
  type RuntimeConfig,
} from "./runtime-config";

const base: RuntimeConfig = {
  issuer: "http://localhost:3001/oidc",
  clientId: "spa",
  audience: "https://entitlement.luminaryworks.dev",
  consoleRole: "platform",
  paymentsMode: "platform",
  entitlementBaseUrl: "http://localhost:3040",
  experienceApiBase: "http://localhost:3050",
  redirectUri: "",
  postLogoutRedirectUri: "",
  scopes: "openid entitlement:admin",
  iamProvider: "logto",
  legalDocsUrl: "https://docs.luminaryworks.dev/legal",
  legalPolicyVersion: "",
  capacity: { dorisPilotUrl: "", objectStorageUrl: "" },
};

describe("runtime config", () => {
  it("binds localhost callback from the SPA origin", () => {
    const bound = bindRedirects(base, "http://localhost:3050");
    expect(bound.redirectUri).toBe("http://localhost:3050/auth/callback");
    expect(bound.postLogoutRedirectUri).toBe("http://localhost:3050/");
    expect(bound.experienceApiBase).toBe("http://localhost:3050");
  });

  it("rebinds loopback experience aliases to the live page origin", () => {
    const bound = bindRedirects(base, "http://127.0.0.1:3050");
    expect(bound.redirectUri).toBe("http://127.0.0.1:3050/auth/callback");
    expect(bound.postLogoutRedirectUri).toBe("http://127.0.0.1:3050/");
    expect(bound.experienceApiBase).toBe("http://127.0.0.1:3050");
  });

  it("keeps a real Auth Gateway experience origin on another port", () => {
    const bound = bindRedirects(
      { ...base, experienceApiBase: "http://localhost:3010" },
      "http://127.0.0.1:3050",
    );
    expect(bound.experienceApiBase).toBe("http://localhost:3010");
    expect(bound.redirectUri).toBe("http://127.0.0.1:3050/auth/callback");
  });

  it("rejects clientSecret on the public config object", () => {
    expect(() =>
      assertPublicRuntimeConfig({
        ...base,
        clientSecret: "nope",
      } as RuntimeConfig & {
        clientSecret: string;
      }),
    ).toThrow(/secret/i);
  });
});
