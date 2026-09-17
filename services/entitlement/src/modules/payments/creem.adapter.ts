import { createHmac } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { hmacSha256Hex, safeEqualString } from "../../common/crypto";
import { EntitlementException } from "../../common/errors";
import { assertCreemCredentials } from "../../common/payment-credentials";
import { redactPaymentSecrets } from "../../common/payment-crypto";
import { defaultCapabilities } from "../../common/payment-providers";
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
import { creemAllowedHosts, officialCreemBase, paymentFetchJson } from "./payment-http";
import {
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";

const CREEM_MAX_AGE_MS = 5 * 60 * 1000;
const CREEM_CHECKOUT_HOSTS = new Set(["checkout.creem.io"]);

/**
 * Creem webhook signature (Merchant of Record).
 *
 * Documented scheme: HMAC-SHA256 over the **raw request body**, hex digest in
 * the `creem-signature` header.
 * @see https://docs.creem.io/code/webhooks
 *
 * The official SDK also accepts Standard Webhooks
 * (`webhook-id` / `webhook-timestamp` / `webhook-signature`).
 * @see https://cdn.jsdelivr.net/npm/creem@1.5.2/src/webhooks.ts
 */
export function verifyCreemWebhookSignature(
  rawBody: Uint8Array,
  headers: Record<string, string>,
  secret: string,
  nowMs: number,
): void {
  const body = Buffer.from(rawBody);
  if (verifyStandardWebhook(body, headers, secret, nowMs)) return;
  const provided = header(headers, "creem-signature") || header(headers, "x-creem-signature");
  if (!provided) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "creem-signature header is required");
  }
  const expected = hmacSha256Hex(secret, body);
  const normalized = provided.startsWith("sha256=")
    ? provided.slice("sha256=".length).toLowerCase()
    : provided.toLowerCase();
  if (!safeEqualString(expected, normalized)) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Creem webhook signature mismatch");
  }
}

@Injectable()
export class CreemPaymentAdapter implements PaymentAdapter {
  readonly provider = "creem" as const;

  constructor(
    @Optional() @Inject(PAYMENT_FETCH) private readonly fetchImpl?: PaymentFetch,
    @Optional() @Inject(PAYMENT_CLOCK) private readonly clock?: PaymentClock,
  ) {}

  private fetchFn(): PaymentFetch {
    return this.fetchImpl ?? defaultPaymentFetch();
  }

  private now(): Date {
    return (this.clock ?? defaultPaymentClock).now();
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const creds = assertCreemCredentials(input.config.credentials);
    this.assertKeyEnvironment(creds.apiKey, input.config.environment);
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "Creem amount must be a positive integer minor unit",
      );
    }
    const successUrl = input.returnUrl || creds.successUrl;
    if (!successUrl) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "Creem checkout requires successUrl (order returnUrl or credentials)",
      );
    }
    const created = await this.api(input.config, creds, "POST", "/checkouts", {
      product_id: creds.productId,
      request_id: input.orderId,
      units: 1,
      custom_price: input.amountCents,
      success_url: successUrl,
      metadata: { orderId: input.orderId, attemptId: input.attemptId },
    });
    const id = stringField(created, "id");
    const url = stringField(created, "checkout_url");
    if (!id || !url) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Creem checkout did not return a hosted session URL",
      );
    }
    this.assertCheckoutHost(url);
    return {
      provider: this.provider,
      status: "pending",
      providerRef: id,
      checkoutUrl: url,
      qrPayload: null,
      action: {
        type: "redirect",
        attemptId: input.attemptId,
        checkoutId: id,
        merchantOfRecord: true,
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
    const creds = assertCreemCredentials(config.credentials);
    this.assertKeyEnvironment(creds.apiKey, config.environment);
    verifyCreemWebhookSignature(rawBody, headers, creds.webhookSecret, this.now().getTime());
    const payload = parseJsonObject(rawBody);
    const createdAt = timestampMs(payload.created_at);
    assertFreshTimestamp(createdAt, this.now().getTime());
    const eventType = stringField(payload, "eventType") || stringField(payload, "type");
    const eventId = stringField(payload, "id");
    if (!eventId) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Creem event id is required");
    }
    const object = asObject(payload.object) ?? payload;
    const checkout = nestedCheckout(object);
    const meta = { ...metadataOf(checkout ?? {}), ...metadataOf(object) };
    const orderId =
      meta.orderId ||
      stringField(checkout ?? {}, "request_id") ||
      stringField(object, "request_id");
    const attemptId = meta.attemptId || null;
    const providerRef = stringField(checkout ?? {}, "id") || stringField(object, "id") || eventId;
    const ack = { status: 200, body: { received: true } };
    const amounts = creemGrossAmounts(object);

    if (eventType === "checkout.completed") {
      const statusRaw = stringField(object, "status").toLowerCase();
      const paid = statusRaw === "completed" || statusRaw === "paid";
      return {
        eventId,
        orderId,
        attemptId,
        providerRef,
        status: paid ? "succeeded" : "pending",
        requiresQuery: !paid || amounts.grossUnknown,
        amountCents: amounts.grossCents,
        currency: amounts.currency,
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({
          eventType,
          status: statusRaw,
          grossCents: amounts.grossCents,
          netCents: amounts.netCents,
          taxCents: amounts.taxCents,
        }),
        ack,
      };
    }
    if (eventType === "refund.created" || eventType === "dispute.created") {
      const refundGross =
        intField(object, "refund_amount") ?? intField(object, "gross") ?? amounts.grossCents;
      return {
        eventId,
        orderId,
        attemptId,
        providerRef,
        status: "refunded",
        amountCents: refundGross,
        currency: stringField(object, "refund_currency").toUpperCase() || amounts.currency,
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({
          eventType,
          reason: stringField(object, "reason") || "provider_initiated_refund",
          grossCents: refundGross,
          netCents: amounts.netCents,
          taxCents: amounts.taxCents,
          inbound: true,
        }),
        ack,
      };
    }
    if (
      eventType === "checkout.expired" ||
      eventType === "subscription.past_due" ||
      eventType === "subscription.unpaid"
    ) {
      return {
        eventId,
        orderId,
        attemptId,
        providerRef,
        status: "failed",
        amountCents: amounts.grossCents,
        currency: amounts.currency,
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({ eventType }),
        ack,
      };
    }
    return {
      eventId,
      orderId,
      attemptId,
      providerRef,
      status: "ignored",
      amountCents: 0,
      currency: amounts.currency,
      payload: redactPaymentSecrets({ eventType, reason: "unmapped_event" }),
      ack,
    };
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const creds = assertCreemCredentials(config.credentials);
    this.assertKeyEnvironment(creds.apiKey, config.environment);
    if (providerRef.startsWith("tran_") || providerRef.startsWith("txn_")) {
      const transaction = await this.api(
        config,
        creds,
        "GET",
        `/transactions?transaction_id=${encodeURIComponent(providerRef)}`,
      );
      return this.fromTransaction(transaction, config, providerRef);
    }
    const checkout = await this.api(
      config,
      creds,
      "GET",
      `/checkouts?checkout_id=${encodeURIComponent(providerRef)}`,
    );
    return this.fromCheckout(checkout, config, providerRef);
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertCreemCredentials(config.credentials);
    this.assertKeyEnvironment(creds.apiKey, config.environment);
    const transactionId = await this.resolveTransactionId(input.providerRef, config, creds);
    // Official OpenAPI documents POST /v1/refunds as full remaining by
    // transaction_id. Dashboard/webhooks use refund_amount for partials, so we
    // send it for platform-initiated partial refunds.
    // @see https://docs.creem.io/api-reference/endpoint/refund-payment
    const result = await this.api(config, creds, "POST", "/refunds", {
      transaction_id: transactionId,
      refund_amount: input.amountCents,
    });
    const statusRaw = stringField(result, "status").toLowerCase();
    const status =
      statusRaw === "succeeded"
        ? "succeeded"
        : statusRaw === "failed" || statusRaw === "canceled"
          ? "failed"
          : "pending";
    return {
      providerRef: stringField(result, "id") || transactionId,
      status,
      amountCents: intField(result, "refund_amount") ?? input.amountCents,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      apiBase: officialCreemBase(config.environment),
      remoteTested: false,
      hostedCheckoutOnly: true,
      merchantOfRecord: true,
    };
    try {
      const creds = assertCreemCredentials(config.credentials);
      this.assertKeyEnvironment(creds.apiKey, config.environment);
      diagnostics.apiKeyLastFour = creds.apiKey.slice(-4);
      diagnostics.webhookSecretLastFour = creds.webhookSecret.slice(-4);
      diagnostics.productIdLastFour = creds.productId.slice(-4);
      if (opts?.remote) {
        await this.api(config, creds, "GET", "/products/search");
        diagnostics.remoteTested = true;
      }
    } catch (err) {
      issues.push(healthIssueMessage(err));
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("creem"),
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private fromCheckout(
    checkout: Record<string, unknown>,
    config: ProviderConfig,
    fallbackRef: string,
  ): PaymentQueryResult {
    const id = stringField(checkout, "id") || fallbackRef;
    const statusRaw = stringField(checkout, "status").toLowerCase();
    const amounts = creemGrossAmounts(checkout);
    const meta = metadataOf(checkout);
    const mapped =
      statusRaw === "completed"
        ? "succeeded"
        : statusRaw === "expired"
          ? "expired"
          : statusRaw === "failed" || statusRaw === "canceled"
            ? "failed"
            : "pending";
    return {
      providerRef: id,
      orderId: meta.orderId || stringField(checkout, "request_id") || null,
      attemptId: meta.attemptId || null,
      status: mapped,
      amountCents: amounts.grossCents,
      currency: amounts.currency,
      merchantId: config.merchantId,
    };
  }

  private fromTransaction(
    transaction: Record<string, unknown>,
    config: ProviderConfig,
    fallbackRef: string,
  ): PaymentQueryResult {
    const id = stringField(transaction, "id") || fallbackRef;
    const statusRaw = stringField(transaction, "status").toLowerCase();
    const amounts = creemGrossAmounts(transaction);
    const mapped =
      statusRaw === "paid"
        ? "succeeded"
        : statusRaw === "pending"
          ? "pending"
          : statusRaw === "canceled" ||
              statusRaw === "declined" ||
              statusRaw === "void" ||
              statusRaw === "uncollectible"
            ? "failed"
            : "succeeded";
    return {
      providerRef: id,
      status: mapped,
      amountCents: amounts.grossCents,
      currency: amounts.currency,
      merchantId: config.merchantId,
    };
  }

  private async resolveTransactionId(
    providerRef: string,
    config: ProviderConfig,
    creds: ReturnType<typeof assertCreemCredentials>,
  ): Promise<string> {
    if (providerRef.startsWith("tran_") || providerRef.startsWith("txn_")) return providerRef;
    const checkout = await this.api(
      config,
      creds,
      "GET",
      `/checkouts?checkout_id=${encodeURIComponent(providerRef)}`,
    );
    const order = asObject(checkout.order);
    const fromOrder = order ? stringField(order, "transaction") : "";
    const fromCheckout = stringField(checkout, "transaction");
    const id = fromOrder || fromCheckout;
    if (!id) {
      throw new EntitlementException(
        "PAYMENT_REFUND_UNSUPPORTED",
        "Creem refund requires a transaction id from the checkout",
      );
    }
    return id;
  }

  private async api(
    config: ProviderConfig,
    creds: ReturnType<typeof assertCreemCredentials>,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = `${officialCreemBase(config.environment)}${path}`;
    try {
      const { status, json, text } = await paymentFetchJson(
        this.fetchFn(),
        url,
        {
          method,
          headers: {
            "x-api-key": creds.apiKey,
            accept: "application/json",
            "content-type": "application/json",
          },
          body: method === "GET" || body === undefined ? undefined : JSON.stringify(body),
        },
        { allowedHosts: creemAllowedHosts() },
      );
      if (status >= 400) {
        throw new EntitlementException(
          "PAYMENT_PROVIDER_UNAVAILABLE",
          `Creem API ${method} failed`,
          { details: { status, bodyLength: text.length } },
        );
      }
      if (Array.isArray(json)) return { items: json };
      if (!json || typeof json !== "object") {
        throw new EntitlementException(
          "PAYMENT_PROVIDER_UNAVAILABLE",
          "Creem API returned an empty body",
        );
      }
      return json as Record<string, unknown>;
    } catch (err) {
      if (err instanceof EntitlementException) throw err;
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") {
        throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", "Payment gateway timed out");
      }
      throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", "Creem API request failed");
    }
  }

  private assertKeyEnvironment(apiKey: string, environment: "sandbox" | "live"): void {
    const testKey = apiKey.startsWith("creem_test_");
    if (environment === "live" && testKey) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "creem live environment requires a live creem_ API key",
      );
    }
    if (environment === "sandbox" && !testKey) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "creem sandbox environment requires a creem_test_ API key",
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
        "Creem checkout URL is malformed",
      );
    }
    if (parsed.protocol !== "https:") {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Creem checkout URL must be HTTPS",
      );
    }
    const host = parsed.hostname.toLowerCase();
    if (!CREEM_CHECKOUT_HOSTS.has(host)) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Creem checkout URL is not an official hosted checkout host",
      );
    }
  }
}

function verifyStandardWebhook(
  body: Buffer,
  headers: Record<string, string>,
  secret: string,
  nowMs: number,
): boolean {
  const id = header(headers, "webhook-id");
  const timestampHeader = header(headers, "webhook-timestamp");
  const signatureHeader = header(headers, "webhook-signature");
  if (!id || !timestampHeader || !signatureHeader) return false;
  const timestampSec = Number(timestampHeader);
  assertFreshTimestamp(timestampSec * 1000, nowMs);
  const secretValue = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const signed = `${id}.${timestampHeader}.${body.toString("utf8")}`;
  const expected = createHmac("sha256", Buffer.from(secretValue, "base64"))
    .update(signed)
    .digest("base64");
  for (const versioned of signatureHeader.split(/\s+/)) {
    const comma = versioned.indexOf(",");
    const version = comma > 0 ? versioned.slice(0, comma) : "";
    const signature = comma > 0 ? versioned.slice(comma + 1) : "";
    if (version === "v1" && signature && safeEqualString(signature, expected)) return true;
  }
  throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Creem webhook signature mismatch");
}

function assertFreshTimestamp(createdAtMs: number, nowMs: number): void {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Creem webhook timestamp is invalid");
  }
  const ageMs = nowMs - createdAtMs;
  if (ageMs > CREEM_MAX_AGE_MS || ageMs < -60_000) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "Creem webhook timestamp is outside the 5-minute replay window",
    );
  }
}

/**
 * MoR amounts are tax-inclusive. Fulfilment compares **gross** (amount the buyer
 * paid). `net` is recorded for reconciliation only and must never be used as
 * the snapshot-match amount.
 */
export function creemGrossAmounts(payload: Record<string, unknown>): {
  grossCents: number;
  netCents: number | null;
  taxCents: number | null;
  currency: string;
  grossUnknown: boolean;
} {
  const order = asObject(payload.order);
  const transaction = asObject(payload.transaction);
  const product = asObject(payload.product);
  const sources = [payload, order, transaction, product].filter(Boolean) as Record<
    string,
    unknown
  >[];
  const currency = firstString(sources, ["currency", "refund_currency"]) || "USD";
  const taxMode = firstString(sources, ["tax_mode"]).toLowerCase();
  const gross = firstInt(sources, ["amount_paid", "gross", "gross_amount", "grossCents"]) ?? null;
  const tax = firstInt(sources, ["tax_amount", "tax", "taxCents"]);
  const listedAmount = firstInt(sources, ["amount"]);
  const net =
    firstInt(sources, ["net", "net_amount", "netCents", "sub_total"]) ??
    (gross != null && tax != null ? gross - tax : null) ??
    (taxMode === "exclusive" ? listedAmount : null);
  if (gross != null) {
    return {
      grossCents: gross,
      netCents: net,
      taxCents: tax,
      currency: currency.toUpperCase(),
      grossUnknown: false,
    };
  }
  if (listedAmount != null && tax != null) {
    const inclusive = taxMode !== "exclusive";
    return {
      grossCents: inclusive ? listedAmount : listedAmount + tax,
      netCents: inclusive ? listedAmount - tax : listedAmount,
      taxCents: tax,
      currency: currency.toUpperCase(),
      grossUnknown: false,
    };
  }
  return {
    grossCents: listedAmount ?? 0,
    netCents: net,
    taxCents: tax,
    currency: currency.toUpperCase(),
    grossUnknown: listedAmount == null || taxMode === "exclusive",
  };
}

function header(headers: Record<string, string>, name: string): string {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] ?? "";
}

function parseJsonObject(rawBody: Uint8Array): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Creem webhook JSON is invalid");
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function intField(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

function firstInt(sources: Record<string, unknown>[], keys: string[]): number | null {
  for (const source of sources) {
    for (const key of keys) {
      const value = intField(source, key);
      if (value != null) return value;
    }
  }
  return null;
}

function firstString(sources: Record<string, unknown>[], keys: string[]): string {
  for (const source of sources) {
    for (const key of keys) {
      const value = stringField(source, key);
      if (value) return value;
    }
  }
  return "";
}

function metadataOf(payload: Record<string, unknown>): Record<string, string> {
  const value = payload.metadata;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (typeof nested === "string") out[key] = nested;
  }
  return out;
}

function healthIssueMessage(err: unknown): string {
  if (err instanceof EntitlementException) {
    const response = err.getResponse();
    if (response && typeof response === "object" && "error" in response) {
      const nested = (response as { error?: { message?: string } }).error?.message;
      if (nested) return nested;
    }
  }
  return err instanceof Error ? err.message : "credential_invalid";
}

function nestedCheckout(object: Record<string, unknown>): Record<string, unknown> | null {
  const nested = asObject(object.checkout);
  if (nested) return nested;
  return stringField(object, "object") === "checkout" ? object : null;
}

function timestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}
