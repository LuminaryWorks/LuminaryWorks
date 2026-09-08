import type { BillingMarket } from "./catalog-pricing";
import {
  CN_HOSTED_ALLOWLIST,
  isCryptoProvider,
  isProviderId,
  type PaymentMarketPolicy,
  type ProviderId,
} from "./payment-providers";

export interface RoutableProviderConfig {
  id: string;
  providerId: string;
  enabled: boolean;
  status: string;
  marketScopes: string[];
  currencies: string[];
  priority: number;
  healthy: boolean;
}

export type ProviderRouteRejectCode =
  | "PAYMENT_PROVIDER_UNAVAILABLE"
  | "PAYMENT_PROVIDER_FORBIDDEN_MARKET";

export interface ProviderRouteDecision {
  allowed: RoutableProviderConfig[];
  rejected: Array<{
    configId: string;
    providerId: string;
    code: ProviderRouteRejectCode;
    reason: string;
  }>;
}

export function cryptoCountryBlocked(input: {
  ipCountry: string | null;
  billingCountry: string | null;
}): boolean {
  if (input.ipCountry === "CN" || input.billingCountry === "CN") return true;
  return false;
}

export function cryptoCheckoutAllowed(input: {
  ipCountry: string | null;
  billingCountry: string | null;
}): boolean {
  if (cryptoCountryBlocked(input)) return false;
  if (!input.billingCountry) return false;
  return input.billingCountry !== "CN";
}

export function selectAvailableProviders(input: {
  configs: RoutableProviderConfig[];
  market: BillingMarket;
  currency: string;
  ipCountry: string | null;
  billingCountry: string | null;
  marketPolicy: PaymentMarketPolicy;
}): ProviderRouteDecision {
  const allowed: RoutableProviderConfig[] = [];
  const rejected: ProviderRouteDecision["rejected"] = [];
  const sorted = [...input.configs].sort(
    (a, b) => a.priority - b.priority || a.providerId.localeCompare(b.providerId),
  );

  for (const config of sorted) {
    if (!config.enabled || config.status === "disabled" || !config.healthy) {
      rejected.push({
        configId: config.id,
        providerId: config.providerId,
        code: "PAYMENT_PROVIDER_UNAVAILABLE",
        reason: "Provider config is not operationally enabled",
      });
      continue;
    }
    if (!isProviderId(config.providerId)) {
      rejected.push({
        configId: config.id,
        providerId: config.providerId,
        code: "PAYMENT_PROVIDER_UNAVAILABLE",
        reason: "Unknown provider",
      });
      continue;
    }
    if (
      config.marketScopes.length > 0 &&
      !config.marketScopes.includes(input.market) &&
      input.marketPolicy === "scopes_only"
    ) {
      rejected.push({
        configId: config.id,
        providerId: config.providerId,
        code: "PAYMENT_PROVIDER_FORBIDDEN_MARKET",
        reason: "Market is outside configured scopes",
      });
      continue;
    }
    if (config.currencies.length > 0 && !config.currencies.includes(input.currency)) {
      rejected.push({
        configId: config.id,
        providerId: config.providerId,
        code: "PAYMENT_PROVIDER_UNAVAILABLE",
        reason: "Currency is not supported by this provider config",
      });
      continue;
    }
    if (input.marketPolicy === "hosted" && input.market === "CN") {
      if (!(CN_HOSTED_ALLOWLIST as readonly string[]).includes(config.providerId)) {
        rejected.push({
          configId: config.id,
          providerId: config.providerId,
          code: "PAYMENT_PROVIDER_FORBIDDEN_MARKET",
          reason: "Hosted CN market only allows Alipay (manual optional)",
        });
        continue;
      }
    }
    if (isCryptoProvider(config.providerId) && !cryptoCheckoutAllowed(input)) {
      rejected.push({
        configId: config.id,
        providerId: config.providerId,
        code: "PAYMENT_PROVIDER_FORBIDDEN_MARKET",
        reason: "Crypto providers require a non-CN IP and a persisted non-CN billing country",
      });
      continue;
    }
    allowed.push(config);
  }

  return { allowed, rejected };
}

export function pickProvider(input: { allowed: RoutableProviderConfig[]; hint?: string | null }): {
  config: RoutableProviderConfig | null;
  hintForbidden: boolean;
} {
  if (input.allowed.length === 0) return { config: null, hintForbidden: false };
  if (input.hint) {
    const hinted = input.allowed.find((item) => item.providerId === input.hint);
    if (hinted) return { config: hinted, hintForbidden: false };
  }
  return { config: input.allowed[0] ?? null, hintForbidden: false };
}

export function hintForbiddenInDecision(
  decision: ProviderRouteDecision,
  hint: string | undefined | null,
): boolean {
  if (!hint) return false;
  return decision.rejected.some(
    (item) => item.providerId === hint && item.code === "PAYMENT_PROVIDER_FORBIDDEN_MARKET",
  );
}

export type { ProviderId };
