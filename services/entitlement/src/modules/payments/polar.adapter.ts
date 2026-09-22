import { createHmac } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { safeEqualString } from "../../common/crypto";
import { EntitlementException } from "../../common/errors";
import { assertPolarCredentials } from "../../common/payment-credentials";
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
import { officialPolarBase, paymentFetchJson, polarAllowedHosts } from "./payment-http";
import {
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";

const POLAR_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Polar webhook signature (Merchant of Record).
 *
 * Polar follows Standard Webhooks (`webhook-id` / `webhook-timestamp` /
 * `webhook-signature`). The dashboard secret is UTF-8 text that must be
 * base64-encoded before the Standard Webhooks HMAC key is derived — matching
 * `@polar-sh/sdk` `validateEvent`.
 * @see https://polar.sh/docs/integrate/webhooks/delivery
 * @see https://cdn.jsdelivr.net/npm/@polar-sh/sdk/src/webhooks.ts
 */
export function verifyPolarWebhookSignature(
  rawBody: Uint8Array,
  headers: Record<string, string>,
  secret: string,
  nowMs: number,
): void {
  const body = Buffer.from(rawBody);
  const id = header(headers, "webhook-id");
  const timestampHeader = header(headers, "webhook-timestamp");
  const signatureHeader = header(headers, "webhook-signature");
  if (!id || !timestampHeader || !signatureHeader) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "Polar Standard Webhooks headers are required",
    );
  }
  const timestampSec = Number(timestampHeader);
  assertFreshTimestamp(timestampSec * 1000, nowMs);
  const signed = `${id}.${timestampHeader}.${body.toString("utf8")}`;
  const key = Buffer.from(Buffer.from(secret, "utf8").toString("base64"), "base64");
  const expected = createHmac("sha256", key).update(signed).digest("base64");
  for (const versioned of signatureHeader.split(/\s+/)) {
    const comma = versioned.indexOf(",");
    const version = comma > 0 ? versioned.slice(0, comma) : "";
    const signature = comma > 0 ? versioned.slice(comma + 1) : "";
    if (version === "v1" && signature && safeEqualString(signature, expected)) return;
  }
  throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Polar webhook signature mismatch");
}

@Injectable()
export class PolarPaymentAdapter implements PaymentAdapter {
  readonly provider = "polar" as const;

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
    const creds = assertPolarCredentials(input.config.credentials);
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "Polar amount must be a positive integer minor unit",
      );
    }
    const successUrl = input.returnUrl || creds.successUrl;
    if (!successUrl) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "Polar checkout requires successUrl (order returnUrl or credentials)",
      );
    }
    const created = await this.api(input.config, creds, "POST", "/checkouts/", {
      products: [creds.productId],
      amount: input.amountCents,
      success_url: successUrl,
      metadata: { orderId: input.orderId, attemptId: input.attemptId },
    });
    const id = stringField(created, "id");
    const url = stringField(created, "url");
    if (!id || !url) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Polar checkout did not return a hosted session URL",
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
    const creds = assertPolarCredentials(config.credentials);
    verifyPolarWebhookSignature(rawBody, headers, creds.webhookSecret, this.now().getTime());
    const payload = parseJsonObject(rawBody);
    const eventType = stringField(payload, "type");
    const eventId = header(headers, "webhook-id") || stringField(payload, "id");
    if (!eventId) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Polar event id is required");
    }
    const data = asObject(payload.data) ?? payload;
    const meta = metadataOf(data);
    const orderId = meta.orderId || "";
    const attemptId = meta.attemptId || null;
    const providerRef =
      stringField(data, "checkout_id") || stringField(data, "id") || eventId;
    const ack = { status: 200, body: { received: true } };
    const amounts = polarGrossAmounts(data);

    if (eventType === "order.paid" || eventType === "checkout.updated") {
      const statusRaw = stringField(data, "status").toLowerCase();
      const paid =
        eventType === "order.paid" ||
        statusRaw === "succeeded" ||
        statusRaw === "paid" ||
        statusRaw === "confirmed";
      if (eventType === "checkout.updated" && !paid) {
        return {
          eventId,
          orderId,
          attemptId,
          providerRef,
          status: "ignored",
          amountCents: amounts.grossCents,
          currency: amounts.currency,
          merchantId: config.merchantId,
          payload: redactPaymentSecrets({ eventType, status: statusRaw, reason: "not_paid" }),
          ack,
        };
      }
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
    if (
      eventType === "order.refunded" ||
      eventType === "refund.created" ||
      eventType === "refund.updated"
    ) {
      const statusRaw = stringField(data, "status").toLowerCase();
      if (eventType === "refund.updated" && statusRaw && statusRaw !== "succeeded") {
        return {
          eventId,
          orderId,
          attemptId,
          providerRef,
          status: "ignored",
          amountCents: amounts.grossCents,
          currency: amounts.currency,
          merchantId: config.merchantId,
          payload: redactPaymentSecrets({ eventType, status: statusRaw }),
          ack,
        };
      }
      const refundGross =
        intField(data, "amount") ?? intField(data, "refunded_amount") ?? amounts.grossCents;
      return {
        eventId,
        orderId,
        attemptId,
        providerRef,
        status: "refunded",
        amountCents: refundGross,
        currency: stringField(data, "currency").toUpperCase() || amounts.currency,
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({
          eventType,
          reason: stringField(data, "reason") || "provider_initiated_refund",
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
      stringField(data, "status").toLowerCase() === "failed"
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
    const creds = assertPolarCredentials(config.credentials);
    const checkout = await this.api(
      config,
      creds,
      "GET",
      `/checkouts/${encodeURIComponent(providerRef)}`,
    );
    return this.fromCheckout(checkout, config, providerRef);
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertPolarCredentials(config.credentials);
    const orderId = await this.resolveOrderId(input.providerRef, config, creds);
    const result = await this.api(config, creds, "POST", "/refunds/", {
      order_id: orderId,
      reason: "customer_request",
      amount: input.amountCents,
    });
    const statusRaw = stringField(result, "status").toLowerCase();
    const status =
      statusRaw === "succeeded"
        ? "succeeded"
        : statusRaw === "failed" || statusRaw === "canceled"
          ? "failed"
          : "pending";
    return {
      providerRef: stringField(result, "id") || orderId,
      status,
      amountCents: intField(result, "amount") ?? input.amountCents,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      apiBase: officialPolarBase(config.environment),
      remoteTested: false,
      hostedCheckoutOnly: true,
      merchantOfRecord: true,
    };
    try {
      const creds = assertPolarCredentials(config.credentials);
      diagnostics.apiKeyLastFour = creds.apiKey.slice(-4);
      diagnostics.webhookSecretLastFour = creds.webhookSecret.slice(-4);
      diagnostics.productIdLastFour = creds.productId.slice(-4);
      if (opts?.remote) {
        await this.api(config, creds, "GET", "/products/");
        diagnostics.remoteTested = true;
      }
    } catch (err) {
      issues.push(healthIssueMessage(err));
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("polar"),
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
    const amounts = polarGrossAmounts(checkout);
    const meta = metadataOf(checkout);
    const mapped =
      statusRaw === "succeeded" || statusRaw === "confirmed"
        ? "succeeded"
        : statusRaw === "expired"
          ? "expired"
          : statusRaw === "failed"
            ? "failed"
            : "pending";
    return {
      providerRef: id,
      orderId: meta.orderId || "",
      attemptId: meta.attemptId || null,
      status: mapped,
      amountCents: amounts.grossCents,
      currency: amounts.currency,
      merchantId: config.merchantId,
    };
  }

  private async resolveOrderId(
    providerRef: string,
    config: ProviderConfig,
    creds: ReturnType<typeof assertPolarCredentials>,
  ): Promise<string> {
    const listed = await this.api(
      config,
      creds,
      "GET",
      `/orders/?checkout_id=${encodeURIComponent(providerRef)}`,
    );
    const items = Array.isArray(listed.items) ? listed.items : [];
    const first = items.length > 0 && typeof items[0] === "object" && items[0] ? items[0] : null;
    const fromList = first ? stringField(first as Record<string, unknown>, "id") : "";
    if (fromList) return fromList;
    const checkout = await this.api(
      config,
      creds,
      "GET",
      `/checkouts/${encodeURIComponent(providerRef)}`,
    );
    const nested = asObject(checkout.order);
    const fromCheckout =
      stringField(checkout, "order_id") || (nested ? stringField(nested, "id") : "");
    if (fromCheckout) return fromCheckout;
    throw new EntitlementException(
      "PAYMENT_REFUND_UNSUPPORTED",
      "Polar refund requires an order id resolved from the checkout",
    );
  }

  private async api(
    config: ProviderConfig,
    creds: ReturnType<typeof assertPolarCredentials>,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = `${officialPolarBase(config.environment)}${path}`;
    try {
      const { status, json, text } = await paymentFetchJson(
        this.fetchFn(),
        url,
        {
          method,
          headers: {
            authorization: `Bearer ${creds.apiKey}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body: method === "GET" || body === undefined ? undefined : JSON.stringify(body),
        },
        { allowedHosts: polarAllowedHosts() },
      );
      if (status >= 400) {
        throw new EntitlementException(
          "PAYMENT_PROVIDER_UNAVAILABLE",
          `Polar API ${method} failed`,
          { details: { status, bodyLength: text.length } },
        );
      }
      if (Array.isArray(json)) return { items: json };
      if (!json || typeof json !== "object") {
        throw new EntitlementException(
          "PAYMENT_PROVIDER_UNAVAILABLE",
          "Polar API returned an empty body",
        );
      }
      return json as Record<string, unknown>;
    } catch (err) {
      if (err instanceof EntitlementException) throw err;
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") {
        throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", "Payment gateway timed out");
      }
      throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", "Polar API request failed");
    }
  }

  private assertCheckoutHost(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Polar checkout URL is malformed",
      );
    }
    if (parsed.protocol !== "https:") {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Polar checkout URL must be HTTPS",
      );
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== "polar.sh" && !host.endsWith(".polar.sh")) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Polar checkout URL is not an official hosted checkout host",
      );
    }
  }
}

function assertFreshTimestamp(createdAtMs: number, nowMs: number): void {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Polar webhook timestamp is invalid");
  }
  const ageMs = nowMs - createdAtMs;
  if (ageMs > POLAR_MAX_AGE_MS || ageMs < -60_000) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "Polar webhook timestamp is outside the 5-minute replay window",
    );
  }
}

/**
 * MoR amounts are tax-inclusive at the buyer. Fulfilment compares **gross**
 * (`total_amount`). `net_amount` is reconciliation-only.
 */
export function polarGrossAmounts(payload: Record<string, unknown>): {
  grossCents: number;
  netCents: number | null;
  taxCents: number | null;
  currency: string;
  grossUnknown: boolean;
} {
  const currency = (stringField(payload, "currency") || "USD").toUpperCase();
  const taxBehavior = stringField(payload, "tax_behavior").toLowerCase();
  const gross =
    intField(payload, "total_amount") ??
    intField(payload, "amount_paid") ??
    intField(payload, "gross") ??
    null;
  const tax = intField(payload, "tax_amount");
  const net = intField(payload, "net_amount");
  const listedAmount = intField(payload, "amount");
  if (gross != null) {
    return {
      grossCents: gross,
      netCents: net,
      taxCents: tax,
      currency,
      grossUnknown: false,
    };
  }
  if (listedAmount != null && tax != null) {
    const inclusive = taxBehavior !== "exclusive";
    return {
      grossCents: inclusive ? listedAmount : listedAmount + tax,
      netCents: inclusive ? listedAmount - tax : listedAmount,
      taxCents: tax,
      currency,
      grossUnknown: false,
    };
  }
  return {
    grossCents: listedAmount ?? 0,
    netCents: net,
    taxCents: tax,
    currency,
    grossUnknown: listedAmount == null || taxBehavior === "exclusive",
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
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Polar webhook JSON is invalid");
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
