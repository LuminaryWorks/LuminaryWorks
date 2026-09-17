export const PAYMENT_PROVIDER_IDS = [
  "alipay_f2f",
  "paypal",
  "wechat_pay_v3",
  "unionpay_quickpass",
  "stripe_checkout",
  "coinbase_commerce",
  "okx_onchain",
  "bitpay",
  "creem",
  "doerflow_credit",
  "manual",
  "mock",
  "contract",
] as const;

export type ProviderId = (typeof PAYMENT_PROVIDER_IDS)[number];

export const CRYPTO_PROVIDER_IDS = [
  "coinbase_commerce",
  "okx_onchain",
  "bitpay",
  "doerflow_credit",
] as const;

export const CN_HOSTED_ALLOWLIST: readonly ProviderId[] = [
  "alipay_f2f",
  "manual",
  "mock",
];

export const PAYMENT_ENVIRONMENTS = ["sandbox", "live"] as const;
export type PaymentEnvironment = (typeof PAYMENT_ENVIRONMENTS)[number];

export type ProviderCapabilities = {
  checkout: boolean;
  webhook: boolean;
  query: boolean;
  refund: boolean;
  partialRefund: boolean;
  hostedUrl: boolean;
  qr: boolean;
  requiresQueryBeforeFulfill: boolean;
};

export const DEFAULT_PROVIDER_CAPABILITIES: Record<
  ProviderId,
  ProviderCapabilities
> = {
  alipay_f2f: {
    checkout: true,
    webhook: true,
    query: true,
    refund: true,
    partialRefund: true,
    hostedUrl: false,
    qr: true,
    requiresQueryBeforeFulfill: false,
  },
  paypal: {
    checkout: true,
    webhook: true,
    query: true,
    refund: true,
    partialRefund: true,
    hostedUrl: true,
    qr: false,
    requiresQueryBeforeFulfill: false,
  },
  wechat_pay_v3: {
    checkout: true,
    webhook: true,
    query: true,
    refund: true,
    partialRefund: true,
    hostedUrl: false,
    qr: true,
    requiresQueryBeforeFulfill: false,
  },
  unionpay_quickpass: {
    checkout: true,
    webhook: true,
    query: true,
    refund: true,
    partialRefund: false,
    hostedUrl: true,
    qr: true,
    requiresQueryBeforeFulfill: false,
  },
  stripe_checkout: {
    checkout: true,
    webhook: true,
    query: true,
    refund: true,
    partialRefund: true,
    hostedUrl: true,
    qr: false,
    requiresQueryBeforeFulfill: false,
  },
  coinbase_commerce: {
    checkout: true,
    webhook: true,
    query: true,
    refund: true,
    partialRefund: true,
    hostedUrl: true,
    qr: false,
    requiresQueryBeforeFulfill: false,
  },
  okx_onchain: {
    checkout: true,
    webhook: false,
    query: true,
    refund: false,
    partialRefund: false,
    hostedUrl: false,
    qr: false,
    requiresQueryBeforeFulfill: false,
  },
  bitpay: {
    checkout: true,
    webhook: true,
    query: true,
    refund: false,
    partialRefund: false,
    hostedUrl: true,
    qr: false,
    requiresQueryBeforeFulfill: true,
  },
  creem: {
    checkout: true,
    webhook: true,
    query: true,
    refund: true,
    partialRefund: true,
    hostedUrl: true,
    qr: false,
    requiresQueryBeforeFulfill: false,
  },
  doerflow_credit: {
    checkout: true,
    webhook: true,
    query: true,
    refund: true,
    partialRefund: true,
    hostedUrl: false,
    qr: false,
    requiresQueryBeforeFulfill: false,
  },
  manual: {
    checkout: true,
    webhook: false,
    query: false,
    refund: true,
    partialRefund: true,
    hostedUrl: false,
    qr: false,
    requiresQueryBeforeFulfill: false,
  },
  mock: {
    checkout: true,
    webhook: true,
    query: true,
    refund: true,
    partialRefund: true,
    hostedUrl: true,
    qr: true,
    requiresQueryBeforeFulfill: false,
  },
  contract: {
    checkout: true,
    webhook: false,
    query: false,
    refund: true,
    partialRefund: true,
    hostedUrl: false,
    qr: false,
    requiresQueryBeforeFulfill: false,
  },
};

export type CredentialFieldSpec = {
  key: string;
  labelKey: string;
  secret?: boolean;
  optional?: boolean;
};

export const STRUCTURED_CREDENTIAL_FIELDS: Partial<
  Record<ProviderId, CredentialFieldSpec[]>
> = {
  creem: [
    { key: "apiKey", labelKey: "providers.fields.apiKey", secret: true },
    {
      key: "webhookSecret",
      labelKey: "providers.fields.webhookSecret",
      secret: true,
    },
    { key: "productId", labelKey: "providers.fields.productId" },
    {
      key: "successUrl",
      labelKey: "providers.fields.successUrl",
      optional: true,
    },
  ],
  doerflow_credit: [
    { key: "baseUrl", labelKey: "providers.fields.baseUrl" },
    {
      key: "serviceKey",
      labelKey: "providers.fields.serviceKey",
      secret: true,
    },
    {
      key: "webhookSecret",
      labelKey: "providers.fields.webhookSecret",
      secret: true,
    },
    {
      key: "merchantAccount",
      labelKey: "providers.fields.merchantAccount",
    },
    { key: "asset", labelKey: "providers.fields.asset", optional: true },
    { key: "chainId", labelKey: "providers.fields.chainId" },
  ],
};

export type ProviderCnRestriction =
  | "hosted_cn_blocked"
  | "crypto_cn_blocked"
  | null;

export function isProviderId(value: string): value is ProviderId {
  return (PAYMENT_PROVIDER_IDS as readonly string[]).includes(value);
}

export function isCryptoProvider(provider: string): boolean {
  return (CRYPTO_PROVIDER_IDS as readonly string[]).includes(provider);
}

export function defaultMarketScopes(providerId: ProviderId): string[] {
  if (providerId === "creem" || providerId === "doerflow_credit") {
    return ["GLOBAL"];
  }
  return [];
}

export function providerCnRestriction(
  providerId: string,
): ProviderCnRestriction {
  if (providerId === "creem") return "hosted_cn_blocked";
  if (isCryptoProvider(providerId)) return "crypto_cn_blocked";
  if (
    isProviderId(providerId) &&
    !(CN_HOSTED_ALLOWLIST as readonly string[]).includes(providerId)
  ) {
    return "hosted_cn_blocked";
  }
  return null;
}

export function capabilityKeys(
  capabilities: ProviderCapabilities,
): (keyof ProviderCapabilities)[] {
  return (
    Object.entries(capabilities) as [keyof ProviderCapabilities, boolean][]
  )
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

export type MorAmountBreakdown = {
  grossCents: number | null;
  taxCents: number | null;
  netCents: number | null;
};

function readMinorAmount(
  source: Record<string, unknown> | null | undefined,
  keys: string[],
): number | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function extractMorAmounts(
  metadata: Record<string, unknown> | null | undefined,
): MorAmountBreakdown {
  return {
    grossCents: readMinorAmount(metadata, [
      "grossCents",
      "gross",
      "gross_amount",
      "amount_paid",
    ]),
    taxCents: readMinorAmount(metadata, ["taxCents", "tax", "tax_amount"]),
    netCents: readMinorAmount(metadata, [
      "netCents",
      "net",
      "net_amount",
      "sub_total",
    ]),
  };
}

export function collectCreemAmounts(detail: {
  order?: Record<string, unknown>;
  attempts?: Record<string, unknown>[];
  refunds?: Record<string, unknown>[];
}): MorAmountBreakdown {
  const sources: Record<string, unknown>[] = [];
  if (detail.order?.metadata && typeof detail.order.metadata === "object") {
    sources.push(detail.order.metadata as Record<string, unknown>);
  }
  for (const attempt of detail.attempts ?? []) {
    if (attempt.metadata && typeof attempt.metadata === "object") {
      sources.push(attempt.metadata as Record<string, unknown>);
    }
    sources.push(attempt);
  }
  for (const refund of detail.refunds ?? []) {
    if (refund.metadata && typeof refund.metadata === "object") {
      sources.push(refund.metadata as Record<string, unknown>);
    }
  }
  const merged: MorAmountBreakdown = {
    grossCents: null,
    taxCents: null,
    netCents: null,
  };
  for (const source of sources) {
    const parsed = extractMorAmounts(source);
    if (merged.grossCents == null && parsed.grossCents != null) {
      merged.grossCents = parsed.grossCents;
    }
    if (merged.taxCents == null && parsed.taxCents != null) {
      merged.taxCents = parsed.taxCents;
    }
    if (merged.netCents == null && parsed.netCents != null) {
      merged.netCents = parsed.netCents;
    }
  }
  const order = detail.order;
  if (merged.grossCents == null && typeof order?.amountCents === "number") {
    merged.grossCents = order.amountCents;
  }
  return merged;
}

export function buildCredentialsObject(
  providerId: ProviderId,
  values: Record<string, string>,
): Record<string, string> {
  const fields = STRUCTURED_CREDENTIAL_FIELDS[providerId];
  if (!fields) {
    throw new Error("structured credentials unavailable");
  }
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key]?.trim() ?? "";
    if (!value && field.optional) continue;
    if (!value) continue;
    out[field.key] = value;
  }
  return out;
}
