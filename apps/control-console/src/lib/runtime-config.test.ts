import { describe, expect, it } from "vitest";
import {
  assertPublicRuntimeConfig,
  bindRedirects,
  type RuntimeConfig,
} from "./runtime-config";

const base: RuntimeConfig = {
  issuer: "http://localhost:3001/oidc",
  clientId: "spa",
  audience: "https://entitlement.luminaryworks.dev",
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
