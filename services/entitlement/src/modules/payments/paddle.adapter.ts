import { createHmac } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { safeEqualString } from "../../common/crypto";
import { EntitlementException } from "../../common/errors";
import { assertPaddleCredentials } from "../../common/payment-credentials";
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
import { officialPaddleBase, paddleAllowedHosts, paymentFetchJson } from "./payment-http";
import {
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";

const PADDLE_MAX_AGE_MS = 5 * 60 * 1000;
const PADDLE_API_VERSION = "1";

/**
 * Paddle Billing webhook signature (Merchant of Record).
 *
 * Documented scheme: HMAC-SHA256 over `${ts}:${rawBody}` using the notification
 * destination `endpoint_secret_key`; hex digest compared to `h1` values in the
 * `Paddle-Signature` header (`ts=…;h1=…`).
 * @see https://developer.paddle.com/webhooks/signature-verification
 */
export function verifyPaddleWebhookSignature(
  rawBody: Uint8Array,
  headers: Record<string, string>,
  secret: string,
  nowMs: number,
): void {
  const signatureHeader = header(headers, "paddle-signature");
  if (!signatureHeader) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "Paddle-Signature header is required",
    );
  }
  const parts = parsePaddleSignature(signatureHeader);
  if (!parts.ts || parts.h1.length === 0) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "Paddle-Signature must include ts and h1",
    );
  }
  const timestampSec = Number(parts.ts);
  assertFreshTimestamp(timestampSec * 1000, nowMs);
  const body = Buffer.from(rawBody).toString("utf8");
  const signed = `${parts.ts}:${body}`;
  const expected = createHmac("sha256", secret).update(signed).digest("hex");
  for (const candidate of parts.h1) {
    if (candidate && safeEqualString(candidate.toLowerCase(), expected)) return;
  }
  throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Paddle webhook signature mismatch");
}

@Injectable()
export class PaddlePaymentAdapter implements PaymentAdapter {
  readonly provider = "paddle" as const;

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
    const creds = assertPaddleCredentials(input.config.credentials);
    this.assertKeyEnvironment(creds.apiKey, input.config.environment);
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "Paddle amount must be a positive integer minor unit",
      );
    }
    const checkoutUrl = input.returnUrl || creds.successUrl;
    const body: Record<string, unknown> = {
      items: [{ price_id: creds.priceId, quantity: 1 }],
      custom_data: {
        orderId: input.orderId,
        attemptId: input.attemptId,
        amountCents: String(input.amountCents),
      },
    };
    if (checkoutUrl) {
      body.checkout = { url: checkoutUrl };
    }
    const created = await this.api(input.config, creds, "POST", "/transactions", body);
    const id = stringField(created, "id");
    const checkout = asObject(created.checkout);
    const url = checkout ? stringField(checkout, "url") : "";
    if (!id || !url) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Paddle transaction did not return a hosted checkout URL",
      );
    }
    this.assertCheckoutUrl(url, id);
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
    const creds = assertPaddleCredentials(config.credentials);
    this.assertKeyEnvironment(creds.apiKey, config.environment);
    verifyPaddleWebhookSignature(rawBody, headers, creds.webhookSecret, this.now().getTime());
    const payload = parseJsonObject(rawBody);
    const eventType = stringField(payload, "event_type") || stringField(payload, "eventType");
    const eventId =
      stringField(payload, "event_id") ||
      stringField(payload, "notification_id") ||
      stringField(payload, "id");
    if (!eventId) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Paddle event id is required");
    }
    const data = asObject(payload.data) ?? payload;
    const meta = metadataOf(data);
    const orderId = meta.orderId || "";
    const attemptId = meta.attemptId || null;
    const providerRef =
      stringField(data, "transaction_id") || stringField(data, "id") || eventId;
    const ack = { status: 200, body: { received: true } };
    const amounts = paddleGrossAmounts(data);

    if (eventType === "transaction.completed") {
      return {
        eventId,
        orderId,
        attemptId,
        providerRef: stringField(data, "id") || providerRef,
        status: "succeeded",
        requiresQuery: amounts.grossUnknown,
        amountCents: amounts.grossCents,
        currency: amounts.currency,
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({
          eventType,
          status: stringField(data, "status"),
          grossCents: amounts.grossCents,
          netCents: amounts.netCents,
          taxCents: amounts.taxCents,
        }),
        ack,
      };
    }
    if (
      eventType === "transaction.payment_failed" ||
      eventType === "transaction.canceled" ||
      eventType === "transaction.past_due"
    ) {
      return {
        eventId,
        orderId,
        attemptId,
        providerRef: stringField(data, "id") || providerRef,
        status: "failed",
        amountCents: amounts.grossCents,
        currency: amounts.currency,
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({ eventType, status: stringField(data, "status") }),
        ack,
      };
    }
    if (eventType === "adjustment.created" || eventType === "adjustment.updated") {
      const action = stringField(data, "action").toLowerCase();
      const statusRaw = stringField(data, "status").toLowerCase();
      if (action !== "refund" && action !== "chargeback") {
        return {
          eventId,
          orderId,
          attemptId,
          providerRef,
          status: "ignored",
          amountCents: amounts.grossCents,
          currency: amounts.currency,
          merchantId: config.merchantId,
          payload: redactPaymentSecrets({ eventType, action, status: statusRaw }),
          ack,
        };
      }
      if (statusRaw === "rejected" || statusRaw === "reversed") {
        return {
          eventId,
          orderId,
          attemptId,
          providerRef,
          status: "ignored",
          amountCents: amounts.grossCents,
          currency: amounts.currency,
          merchantId: config.merchantId,
          payload: redactPaymentSecrets({ eventType, action, status: statusRaw }),
          ack,
        };
      }
      if (statusRaw === "pending_approval") {
        return {
          eventId,
          orderId,
          attemptId,
          providerRef,
          status: "ignored",
          amountCents: amounts.grossCents,
          currency: amounts.currency,
          merchantId: config.merchantId,
          payload: redactPaymentSecrets({
            eventType,
            action,
            status: statusRaw,
            reason: "refund_pending_approval",
          }),
          ack,
        };
      }
      const refundGross =
        amounts.grossCents ||
        intField(asObject(data.totals) ?? {}, "total") ||
        0;
      return {
        eventId,
        orderId,
        attemptId,
        providerRef: stringField(data, "transaction_id") || providerRef,
        status: "refunded",
        amountCents: refundGross,
        currency: stringField(data, "currency_code").toUpperCase() || amounts.currency,
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({
          eventType,
          action,
          status: statusRaw,
          reason: stringField(data, "reason") || "provider_initiated_refund",
          grossCents: refundGross,
          netCents: amounts.netCents,
          taxCents: amounts.taxCents,
          inbound: true,
        }),
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
    const creds = assertPaddleCredentials(config.credentials);
    this.assertKeyEnvironment(creds.apiKey, config.environment);
    const transaction = await this.api(
      config,
      creds,
      "GET",
      `/transactions/${encodeURIComponent(providerRef)}`,
    );
    return this.fromTransaction(transaction, config, providerRef);
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertPaddleCredentials(config.credentials);
    this.assertKeyEnvironment(creds.apiKey, config.environment);
    const transaction = await this.api(
      config,
      creds,
      "GET",
      `/transactions/${encodeURIComponent(input.providerRef)}`,
    );
    const totals = paddleGrossAmounts(transaction);
    const body: Record<string, unknown> = {
      action: "refund",
      transaction_id: stringField(transaction, "id") || input.providerRef,
      reason: "customer_request",
    };
    if (totals.grossCents > 0 && input.amountCents >= totals.grossCents) {
      body.type = "full";
    } else {
      const itemId = firstLineItemId(transaction);
      if (!itemId) {
        throw new EntitlementException(
          "PAYMENT_REFUND_UNSUPPORTED",
          "Paddle partial refund requires a transaction line item id",
        );
      }
      body.type = "partial";
      body.items = [{ item_id: itemId, type: "partial", amount: String(input.amountCents) }];
    }
    const result = await this.api(config, creds, "POST", "/adjustments", body);
    const statusRaw = stringField(result, "status").toLowerCase();
    const status =
      statusRaw === "approved"
        ? "succeeded"
        : statusRaw === "rejected" || statusRaw === "reversed"
          ? "failed"
          : "pending";
    const resultTotals = asObject(result.totals);
    return {
      providerRef: stringField(result, "id") || input.providerRef,
      status,
      amountCents: (resultTotals ? intField(resultTotals, "total") : null) ?? input.amountCents,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      apiBase: officialPaddleBase(config.environment),
      remoteTested: false,
      hostedCheckoutOnly: true,
      merchantOfRecord: true,
    };
    try {
      const creds = assertPaddleCredentials(config.credentials);
      this.assertKeyEnvironment(creds.apiKey, config.environment);
      diagnostics.apiKeyLastFour = creds.apiKey.slice(-4);
      diagnostics.webhookSecretLastFour = creds.webhookSecret.slice(-4);
      diagnostics.priceIdLastFour = creds.priceId.slice(-4);
      if (opts?.remote) {
        await this.api(config, creds, "GET", "/event-types");
        diagnostics.remoteTested = true;
      }
    } catch (err) {
      issues.push(healthIssueMessage(err));
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("paddle"),
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private fromTransaction(
    transaction: Record<string, unknown>,
    config: ProviderConfig,
    fallbackRef: string,
  ): PaymentQueryResult {
    const id = stringField(transaction, "id") || fallbackRef;
    const statusRaw = stringField(transaction, "status").toLowerCase();
    const amounts = paddleGrossAmounts(transaction);
    const meta = metadataOf(transaction);
    const mapped =
      statusRaw === "completed"
        ? "succeeded"
        : statusRaw === "canceled" || statusRaw === "past_due"
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

  private async api(
    config: ProviderConfig,
    creds: ReturnType<typeof assertPaddleCredentials>,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = `${officialPaddleBase(config.environment)}${path}`;
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
            "paddle-version": PADDLE_API_VERSION,
          },
          body: method === "GET" || body === undefined ? undefined : JSON.stringify(body),
        },
        { allowedHosts: paddleAllowedHosts() },
      );
      if (status >= 400) {
        throw new EntitlementException(
          "PAYMENT_PROVIDER_UNAVAILABLE",
          `Paddle API ${method} failed`,
          { details: { status, bodyLength: text.length } },
        );
      }
      const unwrapped = unwrapPaddleData(json);
      if (!unwrapped) {
        throw new EntitlementException(
          "PAYMENT_PROVIDER_UNAVAILABLE",
          "Paddle API returned an empty body",
        );
      }
      return unwrapped;
    } catch (err) {
      if (err instanceof EntitlementException) throw err;
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") {
        throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", "Payment gateway timed out");
      }
      throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", "Paddle API request failed");
    }
  }

  private assertKeyEnvironment(apiKey: string, environment: "sandbox" | "live"): void {
    const sandboxKey = apiKey.includes("_sdbx_");
    if (environment === "live" && sandboxKey) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "paddle live environment requires a live pdl_live_ API key",
      );
    }
    if (environment === "sandbox" && !sandboxKey && apiKey.includes("_live_")) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "paddle sandbox environment requires a pdl_sdbx_ API key",
      );
    }
  }

  /**
   * Paddle checkout.url is the merchant default payment link + `?_ptxn=txn_…`,
   * or an official Paddle-hosted domain. Require HTTPS and either a matching
   * `_ptxn` query or an official paddle.com host.
   */
  private assertCheckoutUrl(url: string, transactionId: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Paddle checkout URL is malformed",
      );
    }
    if (parsed.protocol !== "https:") {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Paddle checkout URL must be HTTPS",
      );
    }
    const host = parsed.hostname.toLowerCase();
    const ptxn = parsed.searchParams.get("_ptxn") || "";
    const officialHost = host === "paddle.com" || host.endsWith(".paddle.com");
    if (officialHost) return;
    if (ptxn && safeEqualString(ptxn, transactionId)) return;
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Paddle checkout URL is not an official hosted checkout or payment link",
    );
  }
}

function parsePaddleSignature(headerValue: string): { ts: string; h1: string[] } {
  const ts = "";
  const h1: string[] = [];
  let timestamp = "";
  for (const part of headerValue.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === "ts") timestamp = value;
    if (key === "h1" && value) h1.push(value);
  }
  return { ts: timestamp || ts, h1 };
}

function unwrapPaddleData(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  if (Array.isArray(root.data)) return { items: root.data };
  if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
    return root.data as Record<string, unknown>;
  }
  if (!Array.isArray(json)) return root;
  return null;
}

function assertFreshTimestamp(createdAtMs: number, nowMs: number): void {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Paddle webhook timestamp is invalid");
  }
  const ageMs = nowMs - createdAtMs;
  if (ageMs > PADDLE_MAX_AGE_MS || ageMs < -60_000) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "Paddle webhook timestamp is outside the 5-minute replay window",
    );
  }
}

/**
 * MoR amounts are tax-inclusive at the buyer. Fulfilment compares **gross**
 * (`details.totals.total`). Earnings/net are reconciliation-only.
 */
export function paddleGrossAmounts(payload: Record<string, unknown>): {
  grossCents: number;
  netCents: number | null;
  taxCents: number | null;
  currency: string;
  grossUnknown: boolean;
} {
  const details = asObject(payload.details);
  const totals = asObject(details?.totals) ?? asObject(payload.totals);
  const currency =
    (totals ? stringField(totals, "currency_code") : "") ||
    stringField(payload, "currency_code") ||
    "USD";
  const gross = totals ? intField(totals, "total") : null;
  const tax = totals ? intField(totals, "tax") : null;
  const earnings = totals ? intField(totals, "earnings") : null;
  if (gross != null) {
    return {
      grossCents: gross,
      netCents: earnings,
      taxCents: tax,
      currency: currency.toUpperCase(),
      grossUnknown: false,
    };
  }
  return {
    grossCents: 0,
    netCents: earnings,
    taxCents: tax,
    currency: currency.toUpperCase(),
    grossUnknown: true,
  };
}

function firstLineItemId(transaction: Record<string, unknown>): string {
  const details = asObject(transaction.details);
  const lineItems = details && Array.isArray(details.line_items) ? details.line_items : [];
  for (const item of lineItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = stringField(item as Record<string, unknown>, "id");
    if (id) return id;
  }
  return "";
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
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Paddle webhook JSON is invalid");
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
  const value = payload.custom_data ?? payload.metadata;
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
