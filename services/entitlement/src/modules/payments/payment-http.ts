import { EntitlementException } from "../../common/errors";

export const PAYMENT_HTTP_TIMEOUT_MS = 15_000;

export const ALIPAY_GATEWAY = {
  live: "https://openapi.alipay.com/gateway.do",
  sandbox: "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
} as const;

export const ALIPAY_SANDBOX_ALIASES = [
  ALIPAY_GATEWAY.sandbox,
  "https://openapi.alipaydev.com/gateway.do",
] as const;

export const PAYPAL_API_BASE = {
  live: "https://api-m.paypal.com",
  sandbox: "https://api-m.sandbox.paypal.com",
} as const;

export const WECHAT_API_BASE = {
  live: "https://api.mch.weixin.qq.com",
  sandbox: "https://api.mch.weixin.qq.com",
} as const;

export const WECHAT_API_HK = "https://apihk.mch.weixin.qq.com";

export const UNIONPAY_FRONT = {
  live: "https://gateway.95516.com/gateway/api/frontTransReq.do",
  sandbox: "https://gateway.test.95516.com/gateway/api/frontTransReq.do",
} as const;

export const UNIONPAY_BACK = {
  live: "https://gateway.95516.com/gateway/api/backTransReq.do",
  sandbox: "https://gateway.test.95516.com/gateway/api/backTransReq.do",
} as const;

export const UNIONPAY_QUERY = {
  live: "https://gateway.95516.com/gateway/api/queryTrans.do",
  sandbox: "https://gateway.test.95516.com/gateway/api/queryTrans.do",
} as const;

export const STRIPE_API_BASE = {
  live: "https://api.stripe.com",
  sandbox: "https://api.stripe.com",
} as const;

export const COINBASE_BUSINESS_HOST = "business.coinbase.com";

export const COINBASE_CHECKOUT_API_BASE = {
  live: "https://business.coinbase.com/api/v1/checkouts",
  sandbox: "https://business.coinbase.com/sandbox/api/v1/checkouts",
} as const;

export const BITPAY_API_BASE = {
  live: "https://bitpay.com",
  sandbox: "https://test.bitpay.com",
} as const;

export function alipayAllowedHosts(): Set<string> {
  return new Set(
    [ALIPAY_GATEWAY.live, ...ALIPAY_SANDBOX_ALIASES].map((item) => new URL(item).hostname),
  );
}

export function paypalAllowedHosts(): Set<string> {
  return new Set(
    [PAYPAL_API_BASE.live, PAYPAL_API_BASE.sandbox].map((item) => new URL(item).hostname),
  );
}

export function officialAlipayGateway(environment: "sandbox" | "live"): string {
  return environment === "live" ? ALIPAY_GATEWAY.live : ALIPAY_GATEWAY.sandbox;
}

export function officialPaypalBase(environment: "sandbox" | "live"): string {
  return environment === "live" ? PAYPAL_API_BASE.live : PAYPAL_API_BASE.sandbox;
}

export function wechatAllowedHosts(): Set<string> {
  return new Set([WECHAT_API_BASE.live, WECHAT_API_HK].map((item) => new URL(item).hostname));
}

export function officialWechatBase(
  environment: "sandbox" | "live",
  region: "cn" | "hk" = "cn",
): string {
  if (region === "hk") return WECHAT_API_HK;
  return environment === "live" ? WECHAT_API_BASE.live : WECHAT_API_BASE.sandbox;
}

export function unionpayAllowedHosts(): Set<string> {
  return new Set(
    [
      UNIONPAY_FRONT.live,
      UNIONPAY_FRONT.sandbox,
      UNIONPAY_BACK.live,
      UNIONPAY_BACK.sandbox,
      UNIONPAY_QUERY.live,
      UNIONPAY_QUERY.sandbox,
    ].map((item) => new URL(item).hostname),
  );
}

export function officialUnionpayFront(environment: "sandbox" | "live"): string {
  return environment === "live" ? UNIONPAY_FRONT.live : UNIONPAY_FRONT.sandbox;
}

export function officialUnionpayBack(environment: "sandbox" | "live"): string {
  return environment === "live" ? UNIONPAY_BACK.live : UNIONPAY_BACK.sandbox;
}

export function officialUnionpayQuery(environment: "sandbox" | "live"): string {
  return environment === "live" ? UNIONPAY_QUERY.live : UNIONPAY_QUERY.sandbox;
}

export function stripeAllowedHosts(): Set<string> {
  return new Set([new URL(STRIPE_API_BASE.live).hostname]);
}

export function officialStripeBase(environment: "sandbox" | "live"): string {
  return environment === "live" ? STRIPE_API_BASE.live : STRIPE_API_BASE.sandbox;
}

export function coinbaseAllowedHosts(): Set<string> {
  return new Set([COINBASE_BUSINESS_HOST]);
}

export function officialCoinbaseCheckoutBase(environment: "sandbox" | "live"): string {
  return environment === "live"
    ? COINBASE_CHECKOUT_API_BASE.live
    : COINBASE_CHECKOUT_API_BASE.sandbox;
}

export function bitpayAllowedHosts(): Set<string> {
  return new Set(
    [BITPAY_API_BASE.live, BITPAY_API_BASE.sandbox].map((item) => new URL(item).hostname),
  );
}

export function officialBitpayBase(environment: "sandbox" | "live"): string {
  return environment === "live" ? BITPAY_API_BASE.live : BITPAY_API_BASE.sandbox;
}

export function assertOfficialGatewayUrl(url: string, allowedHosts: ReadonlySet<string>): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Payment gateway URL is malformed",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Payment gateway must use HTTPS",
    );
  }
  if (parsed.username || parsed.password) {
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Payment gateway URL must not include credentials",
    );
  }
  if (!allowedHosts.has(parsed.hostname)) {
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Payment gateway host is not an official endpoint",
    );
  }
  return parsed;
}

export async function paymentFetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; allowedHosts: ReadonlySet<string> },
): Promise<{ status: number; text: string; json: unknown }> {
  const response = await paymentFetch(fetchImpl, url, init, opts);
  const text = await response.text();
  let json: unknown = null;
  if (text.trim()) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return { status: response.status, text, json };
}

export async function paymentFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; allowedHosts: ReadonlySet<string> },
): Promise<Response> {
  assertOfficialGatewayUrl(url, opts.allowedHosts);
  const timeoutMs = opts.timeoutMs ?? PAYMENT_HTTP_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof EntitlementException) throw err;
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError") {
      throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", "Payment gateway timed out");
    }
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Payment gateway request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}
