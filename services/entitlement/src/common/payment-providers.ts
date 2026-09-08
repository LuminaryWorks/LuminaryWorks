import type { BillingMarket } from "./catalog-pricing";

export const PAYMENT_PROVIDER_IDS = [
  "alipay_f2f",
  "paypal",
  "wechat_pay_v3",
  "unionpay_quickpass",
  "stripe_checkout",
  "coinbase_commerce",
  "okx_onchain",
  "bitpay",
  "manual",
  "mock",
  "contract",
] as const;

export type ProviderId = (typeof PAYMENT_PROVIDER_IDS)[number];

export const CRYPTO_PROVIDER_IDS = ["coinbase_commerce", "okx_onchain", "bitpay"] as const;
export type CryptoProviderId = (typeof CRYPTO_PROVIDER_IDS)[number];

export const DEV_MANUAL_PROVIDER_IDS = ["mock", "manual", "contract"] as const;

export const PAYMENT_ENVIRONMENTS = ["sandbox", "live"] as const;
export type PaymentEnvironment = (typeof PAYMENT_ENVIRONMENTS)[number];

export const PAYMENT_CONFIG_STATUSES = ["active", "disabled", "retiring"] as const;
export type PaymentConfigStatus = (typeof PAYMENT_CONFIG_STATUSES)[number];

export const ORDER_STATUSES = [
  "pending",
  "created",
  "pending_payment",
  "paid",
  "fulfilled",
  "failed",
  "canceled",
  "expired",
  "refund_pending",
  "partially_refunded",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_ATTEMPT_STATUSES = [
  "created",
  "pending",
  "succeeded",
  "failed",
  "canceled",
  "expired",
] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

export const REFUND_STATUSES = ["pending", "succeeded", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

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

export const DEFAULT_PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
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

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PAYMENT_PROVIDER_IDS as readonly string[]).includes(value);
}

export function isCryptoProvider(provider: string): boolean {
  return (CRYPTO_PROVIDER_IDS as readonly string[]).includes(provider);
}

export function isDevManualProvider(provider: string): boolean {
  return (DEV_MANUAL_PROVIDER_IDS as readonly string[]).includes(provider);
}

export function isUnpaidOrderStatus(status: string): boolean {
  return status === "pending" || status === "created" || status === "pending_payment";
}

export function isPaidLikeOrderStatus(status: string): boolean {
  return status === "paid" || status === "fulfilled";
}

export function isRefundableOrderStatus(status: string): boolean {
  return status === "paid" || status === "fulfilled" || status === "partially_refunded";
}

export const CN_HOSTED_ALLOWLIST: readonly ProviderId[] = ["alipay_f2f", "manual"];

export type PaymentMarketPolicy = "hosted" | "scopes_only";

export function defaultCapabilities(provider: ProviderId): ProviderCapabilities {
  return { ...DEFAULT_PROVIDER_CAPABILITIES[provider] };
}

export function hostedMarketForCountry(country: string | null): BillingMarket {
  return country === "CN" ? "CN" : "GLOBAL";
}
