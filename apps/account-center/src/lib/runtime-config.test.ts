import { describe, expect, it } from "@rstest/core";
import {
  assertPublicRuntimeConfig,
  bindRedirects,
  browserApiBase,
  type RuntimeConfig,
} from "./runtime-config";

const base: RuntimeConfig = {
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
  apps: [
    {
      code: "dataluminary",
      name: "DataLuminary",
      url: "https://data.example",
      description: "Insight",
    },
  ],
};

describe("runtime config", () => {
  it("binds the account center callback from the live origin", () => {
    const bound = bindRedirects(base, "http://localhost:3060");
    expect(bound.redirectUri).toBe("http://localhost:3060/auth/callback");
    expect(bound.postLogoutRedirectUri).toBe("http://localhost:3060/");
    expect(bound.experienceApiBase).toBe("http://localhost:3060");
    expect(bound.apps[0]?.code).toBe("dataluminary");
  });

  it("rebinds a loopback experience alias and keeps a real gateway origin", () => {
    expect(bindRedirects(base, "http://127.0.0.1:3060").experienceApiBase).toBe(
      "http://127.0.0.1:3060",
    );
    expect(
      bindRedirects(
        { ...base, experienceApiBase: "http://localhost:3010" },
        "http://127.0.0.1:3060",
      ).experienceApiBase,
    ).toBe("http://localhost:3010");
  });

  it("uses the dev proxy only for loopback API hosts", () => {
    expect(browserApiBase("http://127.0.0.1:13100", "/ai-api", true)).toBe(
      "/ai-api",
    );
    expect(
      browserApiBase("https://ai.luminaryworks.dev", "/ai-api", true),
    ).toBe("https://ai.luminaryworks.dev");
    expect(browserApiBase("http://127.0.0.1:13100", "/ai-api", false)).toBe(
      "http://127.0.0.1:13100",
    );
  });

  it("rejects a client secret on the public config", () => {
    expect(() =>
      assertPublicRuntimeConfig({
        ...base,
        clientSecret: "nope",
      } as RuntimeConfig & { clientSecret: string }),
    ).toThrow(/secret/i);
  });
});
