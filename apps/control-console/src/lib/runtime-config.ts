export type CapacityConfig = {
  dorisPilotUrl: string;
  objectStorageUrl: string;
};

export type RuntimeConfig = {
  issuer: string;
  clientId: string;
  audience: string;
  entitlementBaseUrl: string;
  experienceApiBase: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scopes: string;
  iamProvider: string;
  legalDocsUrl: string;
  legalPolicyVersion: string;
  capacity: CapacityConfig;
};

const SECRET_KEY =
  /(secret|password|passwd|token|api[-_]?key|private[-_]?key|credential|pepper|master[-_]?key)/i;

export function assertPublicRuntimeConfig(config: RuntimeConfig): void {
  const json = JSON.stringify(config);
  if (
    /"clientSecret"\s*:/.test(json) ||
    (SECRET_KEY.test(json) && /"(sk_|whsec_|lwpay1)/.test(json))
  ) {
    throw new Error("runtime config must not include secrets");
  }
  if ("clientSecret" in (config as object)) {
    throw new Error("runtime config must not include clientSecret");
  }
}

export async function loadRuntimeConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<RuntimeConfig> {
  const res = await fetchImpl("/config.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load /config.json (${res.status})`);
  }
  const config = (await res.json()) as RuntimeConfig;
  assertPublicRuntimeConfig(config);
  return config;
}

export function bindRedirects(
  config: RuntimeConfig,
  origin: string,
): RuntimeConfig {
  const trimmed = origin.replace(/\/$/, "");
  return {
    ...config,
    redirectUri: config.redirectUri || `${trimmed}/auth/callback`,
    postLogoutRedirectUri: config.postLogoutRedirectUri || `${trimmed}/`,
    experienceApiBase: config.experienceApiBase || trimmed,
  };
}
