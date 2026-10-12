export type CapacityConfig = {
  dorisPilotUrl: string;
  objectStorageUrl: string;
};

export type ConsoleRole = "platform" | "tenant";
export type PaymentsMode =
  | "platform"
  | "customer_managed"
  | "external_adapter"
  | "disabled";

export type RuntimeConfig = {
  issuer: string;
  clientId: string;
  audience: string;
  consoleRole: ConsoleRole;
  paymentsMode: PaymentsMode;
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
  const paymentsMode = (
    ["platform", "customer_managed", "external_adapter", "disabled"] as const
  ).includes(config.paymentsMode)
    ? config.paymentsMode
    : "platform";
  const normalized = {
    ...config,
    consoleRole: config.consoleRole === "tenant" ? "tenant" : "platform",
    paymentsMode,
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

/** localhost / 127.0.0.1 / ::1 on the same port are one SPA, not Auth Gateway. */
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
  // Bind redirect URIs to the live browser origin. Keep an absolute
  // experienceApiBase when it already points at Auth Gateway / login
  // (different origin) — overwriting it with the SPA origin breaks cookies
  // and forces a second hop that Logto CORS may reject.
  // Exception: localhost ↔ 127.0.0.1 on the same port is the SPA itself;
  // keeping the other host causes cross-origin "Failed to fetch" on login.
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
