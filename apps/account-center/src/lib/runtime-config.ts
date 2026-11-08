export type PartnerApp = {
  code: string;
  name: string;
  url: string;
  description: string;
};

export type RuntimeConfig = {
  issuer: string;
  clientId: string;
  audience: string;
  aiPlatformBaseUrl: string;
  entitlementBaseUrl: string;
  experienceApiBase: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scopes: string;
  iamProvider: string;
  accountUrl: string;
  securityUrl: string;
  apps: PartnerApp[];
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

function asApps(value: unknown): PartnerApp[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const code = typeof row.code === "string" ? row.code.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const description =
      typeof row.description === "string" ? row.description.trim() : "";
    if (!code || !name || !url) return [];
    return [{ code, name, url, description }];
  });
}

export async function loadRuntimeConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<RuntimeConfig> {
  const res = await fetchImpl("/config.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load /config.json (${res.status})`);
  }
  const config = (await res.json()) as RuntimeConfig;
  const normalized = {
    ...config,
    apps: asApps(config.apps),
    audience: config.audience?.trim() || "https://ai.luminaryworks.dev",
  } satisfies RuntimeConfig;
  assertPublicRuntimeConfig(normalized);
  return normalized;
}

function urlPort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isLoopbackAlias(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return (
      isLoopbackHost(left.hostname) &&
      isLoopbackHost(right.hostname) &&
      urlPort(left) === urlPort(right)
    );
  } catch {
    return false;
  }
}

export function bindRedirects(
  config: RuntimeConfig,
  origin: string,
): RuntimeConfig {
  const trimmed = origin.replace(/\/$/, "");
  const existingExperience = String(config.experienceApiBase || "").trim();
  let experienceApiBase = trimmed;
  if (existingExperience.startsWith("http")) {
    try {
      const experienceOrigin = new URL(existingExperience).origin;
      if (
        experienceOrigin !== trimmed &&
        !isLoopbackAlias(existingExperience, trimmed)
      ) {
        experienceApiBase = existingExperience.replace(/\/$/, "");
      }
    } catch {
      /* keep SPA origin */
    }
  }
  return {
    ...config,
    redirectUri: `${trimmed}/auth/callback`,
    postLogoutRedirectUri: `${trimmed}/`,
    experienceApiBase,
  };
}

/** Dev Rsbuild proxies loopback APIs so the browser stays same-origin. */
export function browserApiBase(
  configured: string,
  proxyPrefix: string,
  dev: boolean,
): string {
  const absolute = configured.replace(/\/$/, "");
  if (!dev || !absolute) return absolute;
  try {
    const host = new URL(absolute).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return proxyPrefix;
    }
  } catch {
    return absolute;
  }
  return absolute;
}
