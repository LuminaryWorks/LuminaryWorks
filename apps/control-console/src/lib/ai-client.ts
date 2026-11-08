import { assertNoSecretPersistence, ConsoleApiError } from "./api-client";

export type AiTokenStore = {
  getAccessToken: () => string | null;
  onUnauthorized: () => void;
};

export type HardeningGates = {
  authn: boolean;
  entitlement: boolean;
  persistentMetering: boolean;
  secretVault: boolean;
  readiness: boolean;
};

export type AiSettings = {
  publicApiEnabled: boolean;
  publicApiSource: "env" | "persisted";
  walletEnforce: boolean;
  hardeningGates: HardeningGates;
};

export type UsageTotals = {
  calls: number;
  chargedMicro: number;
  upstreamCostMicroUsd: number;
  marginMicro: number;
  marginPercent: number | null;
};

export type UsageReport = {
  from: string;
  to: string;
  productCode: string | null;
  summary: UsageTotals;
  groups: Array<UsageTotals & { productCode: string; capability: string }>;
};

export type RateCardLine = {
  capability: string;
  providerType: string;
  model: string;
  unit: string;
  upstreamCostMicroUsd: number;
  markupBps: number;
  fixedFeeMicro: number;
};

export type RateCardVersion = {
  id: string;
  version: number;
  effectiveFrom: string | null;
  createdAt: string | null;
  lines: RateCardLine[];
};

export type DeploymentConnection = {
  uid: string;
  ownerKind: string;
  ownerUid: string;
  providerType: string;
  displayName: string;
  baseUrl: string | null;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  purpose: string | null;
  secretFingerprint: string | null;
  hasSecret: boolean;
  updatedAt: string | null;
};

export type WalletView = {
  wallet: {
    walletId: string;
    ownerKind: string;
    ownerId: string;
    currency: string;
    status: string;
    createdAt: string | null;
  } | null;
  reconciliation: {
    grantedMicro: number;
    remainingMicro: number;
    activeHoldMicro: number;
    settledMicro: number;
    revokedMicro: number;
    balanced: boolean;
  } | null;
  grants: Array<{
    grantId: string;
    walletId: string;
    kind: string;
    amountMicro: number;
    remainingMicro: number;
    expiresAt: string | null;
    createdAt: string | null;
    sourceType: string;
    sourceId: string;
    revokedMicro: number;
  }>;
};

export function createAiClient(opts: {
  tokens: AiTokenStore;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    assertNoSecretPersistence();
    const token = opts.tokens.getAccessToken();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetchImpl(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }
    if (!res.ok) {
      const err = (
        parsed as { error?: { code?: string; message?: string } } | null
      )?.error;
      const code =
        err?.code ||
        (res.status === 401
          ? "UNAUTHORIZED"
          : res.status === 403
            ? "FORBIDDEN"
            : "REQUEST_FAILED");
      const failure = new ConsoleApiError({
        status: res.status,
        code,
        message: err?.message || `HTTP ${res.status}`,
      });
      if (res.status === 401) opts.tokens.onUnauthorized();
      throw failure;
    }
    return parsed as T;
  }

  return {
    settings: () => request<AiSettings>("GET", "/bff/ai/settings"),
    setPublicApi: (enabled: boolean, reason: string) =>
      request<{
        publicApiEnabled: boolean;
        publicApiSource: "env" | "persisted";
      }>("PUT", "/bff/ai/settings/public-api", { enabled, reason }),
    wallets: (ownerKind: string, ownerId: string) => {
      const q = new URLSearchParams({ ownerKind, ownerId });
      return request<WalletView>("GET", `/bff/ai/wallets?${q}`);
    },
    grant: (body: {
      ownerKind: "user" | "organization";
      ownerId: string;
      amountMicro: number;
      expiresAt: string;
      reason: string;
      currency?: "USD" | "CNY";
    }) => request<{ orderId: string }>("POST", "/bff/ai/wallets/grant", body),
    revoke: (body: { orderId: string; reason: string; amountMicro?: number }) =>
      request<Record<string, unknown>>("POST", "/bff/ai/wallets/revoke", body),
    usage: (query: { from: string; to: string; productCode?: string }) => {
      const q = new URLSearchParams({ from: query.from, to: query.to });
      if (query.productCode) q.set("productCode", query.productCode);
      return request<UsageReport>("GET", `/bff/ai/usage?${q}`);
    },
    rateCards: () =>
      request<{ versions: RateCardVersion[] }>("GET", "/bff/ai/rate-cards"),
    publishRateCard: (body: unknown) =>
      request<{ id: string; version: number }>(
        "POST",
        "/bff/ai/rate-cards",
        body,
      ),
    connections: () =>
      request<{ items: DeploymentConnection[] }>("GET", "/bff/ai/connections"),
    createConnection: (body: {
      providerType: string;
      displayName: string;
      model: string;
      secret: string;
      baseUrl?: string;
      purpose?: string;
    }) => request<DeploymentConnection>("POST", "/bff/ai/connections", body),
    updateConnection: (
      uid: string,
      body: {
        enabled?: boolean;
        secret?: string;
        displayName?: string;
        model?: string;
        baseUrl?: string;
      },
    ) =>
      request<DeploymentConnection>(
        "PATCH",
        `/bff/ai/connections/${encodeURIComponent(uid)}`,
        body,
      ),
  };
}

export type AiClient = ReturnType<typeof createAiClient>;
