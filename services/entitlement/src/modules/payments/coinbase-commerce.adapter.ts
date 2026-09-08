import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { hmacSha256Hex, safeEqualString } from "../../common/crypto";
import { EntitlementException } from "../../common/errors";
import { assertCoinbaseCommerceCredentials } from "../../common/payment-credentials";
import { redactPaymentSecrets } from "../../common/payment-crypto";
import { defaultCapabilities } from "../../common/payment-providers";
import { defaultCoinbaseJwtSigner } from "./coinbase-cdp-auth";
import type {
  CheckoutSession,
  CompleteCheckoutInput,
  CreateCheckoutInput,
  HealthCheckOptions,
  HealthStatus,
  PaymentAdapter,
  PaymentQueryResult,
  ProviderConfig,
  RefundInput,
  RefundResult,
  VerifiedWebhook,
} from "./payment-adapter";
import {
  coinbaseAllowedHosts,
  officialCoinbaseCheckoutBase,
  paymentFetchJson,
} from "./payment-http";
import {
  COINBASE_JWT_SIGNER,
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type CoinbaseJwtSigner,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";

const HOOK0_MAX_AGE_MS = 5 * 60 * 1000;
const ALLOWED_CURRENCIES = new Set(["USDC"]);
const SETTLEMENT_NETWORK = "base";

@Injectable()
export class CoinbaseCommercePaymentAdapter implements PaymentAdapter {
  readonly provider = "coinbase_commerce" as const;

  constructor(
    @Optional() @Inject(PAYMENT_FETCH) private readonly fetchImpl?: PaymentFetch,
    @Optional() @Inject(PAYMENT_CLOCK) private readonly clock?: PaymentClock,
    @Optional() @Inject(COINBASE_JWT_SIGNER) private readonly jwtSigner?: CoinbaseJwtSigner,
  ) {}

  private fetchFn(): PaymentFetch {
    return this.fetchImpl ?? defaultPaymentFetch();
  }

  private now(): Date {
    return (this.clock ?? defaultPaymentClock).now();
  }

  private signer(): CoinbaseJwtSigner {
    return this.jwtSigner ?? defaultCoinbaseJwtSigner();
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const creds = assertCoinbaseCommerceCredentials(input.config.credentials);
    this.assertCurrency(input.currency);
    const successRedirectUrl = input.returnUrl || creds.successRedirectUrl;
    const failRedirectUrl = creds.failRedirectUrl || successRedirectUrl;
    if (!successRedirectUrl || !failRedirectUrl) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "Coinbase Business Checkout requires successRedirectUrl and failRedirectUrl (HTTPS)",
      );
    }
    const body = {
      amount: majorFromMinor(input.amountCents),
      currency: "USDC",
      description: `order ${input.orderId}`,
      metadata: { orderId: input.orderId, attemptId: input.attemptId },
      successRedirectUrl,
      failRedirectUrl,
    };
    const created = await this.api(input.config, creds, "POST", "", body, input.attemptId);
    const id = stringField(created, "id");
    const url = stringField(created, "url");
    const network = stringField(created, "network") || SETTLEMENT_NETWORK;
    if (!id || !url) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Coinbase Checkout did not return a hosted payment URL",
      );
    }
    this.assertBaseNetwork(network);
    this.assertCheckoutHost(url);
    return {
      provider: this.provider,
      providerRef: id,
      status: "pending",
      checkoutUrl: url,
      qrPayload: null,
      action: {
        type: "redirect",
        attemptId: input.attemptId,
        checkoutId: id,
        network: SETTLEMENT_NETWORK,
        currency: "USDC",
      },
    };
  }

  async completeCheckout(input: CompleteCheckoutInput): Promise<PaymentQueryResult> {
    return this.queryPayment(input.providerRef, input.config);
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Record<string, string>,
    config: ProviderConfig,
  ): Promise<VerifiedWebhook> {
    const creds = assertCoinbaseCommerceCredentials(config.credentials);
    verifyHook0Signature(rawBody, headers, creds.webhookSecret, this.now().getTime());
    const payload = parseJsonObject(rawBody);
    const eventType = stringField(payload, "eventType") || header(headers, "x-event-type");
    const checkoutId = stringField(payload, "id");
    const eventId =
      header(headers, "x-event-id") ||
      (checkoutId && eventType ? `${checkoutId}:${eventType}` : "");
    if (!eventId) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Coinbase event id is required");
    }
    const ack = { status: 200, body: { received: true } };
    const meta = asStringRecord(payload.metadata);
    const orderId = meta.orderId || "";
    const attemptId = meta.attemptId || null;
    const amount = amountFromCheckout(payload, config);
    const network = stringField(payload, "network") || SETTLEMENT_NETWORK;
    if (network) this.assertBaseNetwork(network);

    if (eventType === "checkout.payment.success") {
      const status = stringField(payload, "status");
      return {
        eventId,
        orderId,
        attemptId,
        providerRef: checkoutId,
        status: status === "COMPLETED" ? "succeeded" : "pending",
        requiresQuery: status !== "COMPLETED",
        amountCents: amount.amountCents,
        currency: amount.currency,
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({
          eventType,
          status,
          transactionHash: payload.transactionHash,
        }),
        ack,
      };
    }
    if (eventType === "checkout.payment.failed" || eventType === "checkout.payment.expired") {
      return {
        eventId,
        orderId,
        attemptId,
        providerRef: checkoutId,
        status: "failed",
        amountCents: amount.amountCents,
        currency: amount.currency,
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({ eventType }),
        ack,
      };
    }
    if (eventType === "checkout.refund.success" || eventType === "checkout.refund.failed") {
      return {
        eventId,
        orderId,
        attemptId,
        providerRef: checkoutId,
        status: "ignored",
        amountCents: 0,
        currency: amount.currency,
        payload: redactPaymentSecrets({ eventType, reason: "refund_via_admin_path" }),
        ack,
      };
    }
    return {
      eventId,
      orderId,
      attemptId,
      providerRef: checkoutId,
      status: "ignored",
      amountCents: 0,
      currency: amount.currency,
      payload: redactPaymentSecrets({ eventType, reason: "unmapped_event" }),
      ack,
    };
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const creds = assertCoinbaseCommerceCredentials(config.credentials);
    const checkout = await this.api(config, creds, "GET", `/${encodeURIComponent(providerRef)}`);
    return this.fromCheckout(checkout, config, providerRef);
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertCoinbaseCommerceCredentials(config.credentials);
    this.assertCurrency(input.currency);
    const result = await this.api(
      config,
      creds,
      "POST",
      `/${encodeURIComponent(input.providerRef)}/refund`,
      {
        amount: majorFromMinor(input.amountCents),
        currency: "USDC",
        reason: input.reason,
      },
      input.idempotencyKey,
    );
    const refund =
      result.refund && typeof result.refund === "object"
        ? (result.refund as Record<string, unknown>)
        : result;
    const statusRaw = stringField(refund, "status").toUpperCase();
    const status =
      statusRaw === "COMPLETED" ? "succeeded" : statusRaw === "FAILED" ? "failed" : "pending";
    const amount = stringField(refund, "amount") || stringField(refund, "fiatAmount");
    return {
      providerRef: stringField(refund, "id") || input.providerRef,
      status,
      amountCents: amount ? minorFromMajor(amount) : input.amountCents,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      apiBase: officialCoinbaseCheckoutBase(config.environment),
      network: SETTLEMENT_NETWORK,
      currency: "USDC",
      remoteTested: false,
      jwtHelper: "cdp-sdk",
    };
    try {
      const creds = assertCoinbaseCommerceCredentials(config.credentials);
      diagnostics.apiKeyIdLastFour = creds.apiKeyId.slice(-4);
      const jwt = await this.signer()({
        apiKeyId: creds.apiKeyId,
        apiKeySecret: creds.apiKeySecret,
        requestMethod: "GET",
        requestHost: "business.coinbase.com",
        requestPath: coinbaseRequestPath(config.environment, ""),
        expiresIn: 120,
      });
      if (!jwt) issues.push("cdp_jwt_empty");
      diagnostics.jwtIssued = Boolean(jwt);
      if (opts?.remote) {
        await this.api(config, creds, "GET", "");
        diagnostics.remoteTested = true;
      }
    } catch (err) {
      issues.push(err instanceof Error ? err.message : "credential_invalid");
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("coinbase_commerce"),
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private fromCheckout(
    checkout: Record<string, unknown>,
    config: ProviderConfig,
    fallbackRef: string,
  ): PaymentQueryResult {
    const id = stringField(checkout, "id") || fallbackRef;
    const statusRaw = stringField(checkout, "status").toUpperCase();
    this.assertBaseNetwork(stringField(checkout, "network") || SETTLEMENT_NETWORK);
    const amount = amountFromCheckout(checkout, config);
    const meta = asStringRecord(checkout.metadata);
    const mapped =
      statusRaw === "COMPLETED"
        ? "succeeded"
        : statusRaw === "FAILED" || statusRaw === "DEACTIVATED"
          ? "failed"
          : statusRaw === "EXPIRED"
            ? "expired"
            : "pending";
    return {
      providerRef: id,
      orderId: meta.orderId || null,
      attemptId: meta.attemptId || null,
      status: mapped,
      amountCents: amount.amountCents,
      currency: amount.currency,
      merchantId: config.merchantId,
      settlementProof: stringField(checkout, "transactionHash")
        ? { transactionHash: stringField(checkout, "transactionHash") }
        : null,
    };
  }

  private async api(
    config: ProviderConfig,
    creds: ReturnType<typeof assertCoinbaseCommerceCredentials>,
    method: string,
    suffix: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const base = officialCoinbaseCheckoutBase(config.environment);
    const url = `${base}${suffix}`;
    const parsed = new URL(url);
    const jwt = await this.signer()({
      apiKeyId: creds.apiKeyId,
      apiKeySecret: creds.apiKeySecret,
      requestMethod: method,
      requestHost: parsed.hostname,
      requestPath: parsed.pathname,
      expiresIn: 120,
    });
    const headers: Record<string, string> = {
      authorization: `Bearer ${jwt}`,
      accept: "application/json",
      "content-type": "application/json",
    };
    if (idempotencyKey) headers["X-Idempotency-Key"] = uuidV4FromSeed(idempotencyKey);
    const { status, json, text } = await paymentFetchJson(
      this.fetchFn(),
      url,
      {
        method,
        headers,
        body: method === "GET" || body === undefined ? undefined : JSON.stringify(body),
      },
      { allowedHosts: coinbaseAllowedHosts() },
    );
    if (status >= 400) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        `Coinbase Checkout API ${method} failed`,
        { details: { status, bodyLength: text.length } },
      );
    }
    if (Array.isArray(json)) return { items: json };
    if (!json || typeof json !== "object") {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Coinbase Checkout API returned an empty body",
      );
    }
    return json as Record<string, unknown>;
  }

  private assertCurrency(currency: string): void {
    if (!ALLOWED_CURRENCIES.has(currency.toUpperCase())) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "Coinbase Business Checkout is USDC-only on Base",
      );
    }
  }

  private assertBaseNetwork(network: string): void {
    if (network.toLowerCase() !== "base") {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "Coinbase Business Checkout is Base-only",
      );
    }
  }

  private assertCheckoutHost(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Coinbase Checkout URL is malformed",
      );
    }
    if (parsed.protocol !== "https:") {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Coinbase Checkout URL must be HTTPS",
      );
    }
    const host = parsed.hostname.toLowerCase();
    if (host === "api.commerce.coinbase.com" || host.endsWith(".commerce.coinbase.com")) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Legacy Coinbase Commerce Charge URLs are not accepted",
      );
    }
  }
}

export function verifyHook0Signature(
  rawBody: Uint8Array,
  headers: Record<string, string>,
  secret: string,
  nowMs: number,
): void {
  const signatureHeader = header(headers, "x-hook0-signature");
  if (!signatureHeader) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "X-Hook0-Signature header is required",
    );
  }
  const parts = parseHook0Header(signatureHeader);
  const timestampSec = Number(parts.t);
  if (!Number.isFinite(timestampSec) || timestampSec <= 0) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Hook0 timestamp is invalid");
  }
  const ageMs = nowMs - timestampSec * 1000;
  if (ageMs > HOOK0_MAX_AGE_MS || ageMs < -60_000) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "Coinbase webhook timestamp is outside the 5-minute replay window",
    );
  }
  const body = Buffer.from(rawBody).toString("utf8");
  const provided = parts.v1 || parts.v0;
  if (!provided) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Hook0 signature is missing");
  }
  const expected = parts.v1
    ? hmacSha256Hex(secret, hook0V1Payload(parts.t, parts.h, headers, body))
    : hmacSha256Hex(secret, `${parts.t}.${body}`);
  if (!safeEqualString(expected, provided)) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Hook0 signature mismatch");
  }
}

function hook0V1Payload(
  timestamp: string,
  headerNames: string,
  headers: Record<string, string>,
  body: string,
): string {
  const values = headerNames
    .split(" ")
    .filter(Boolean)
    .map((name) => header(headers, name))
    .join(".");
  return `${timestamp}.${headerNames}.${values}.${body}`;
}

function parseHook0Header(value: string): { t: string; h: string; v0: string; v1: string } {
  const out = { t: "", h: "", v0: "", v1: "" };
  for (const element of value.split(",")) {
    const idx = element.indexOf("=");
    if (idx <= 0) continue;
    const key = element.slice(0, idx).trim();
    const val = element.slice(idx + 1);
    if (key === "t") out.t = val;
    if (key === "h") out.h = val;
    if (key === "v0") out.v0 = val;
    if (key === "v1") out.v1 = val;
  }
  return out;
}

function coinbaseRequestPath(environment: "sandbox" | "live", suffix: string): string {
  const base = environment === "live" ? "/api/v1/checkouts" : "/sandbox/api/v1/checkouts";
  return `${base}${suffix}`;
}

function uuidV4FromSeed(seed: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seed)) {
    return seed.toLowerCase();
  }
  const hash = createHash("sha256").update(seed).digest();
  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function header(headers: Record<string, string>, name: string): string {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] ?? "";
}

function parseJsonObject(rawBody: Uint8Array): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Coinbase webhook JSON is invalid");
  }
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (typeof nested === "string") out[key] = nested;
  }
  return out;
}

function majorFromMinor(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "Coinbase amount must be a positive integer minor unit",
    );
  }
  return (amountCents / 100).toFixed(2);
}

function minorFromMajor(value: string): number {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "Coinbase amount is not a strict decimal",
    );
  }
  const [whole, frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function amountFromCheckout(
  payload: Record<string, unknown>,
  _config: ProviderConfig,
): { amountCents: number; currency: string } {
  const currency = (stringField(payload, "currency") || "USDC").toUpperCase();
  if (currency !== "USDC") {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "Coinbase Business Checkout is USDC-only on Base",
    );
  }
  const amount = stringField(payload, "amount");
  return { amountCents: amount ? minorFromMajor(amount) : 0, currency: "USDC" };
}
