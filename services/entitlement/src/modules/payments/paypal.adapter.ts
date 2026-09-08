import { Inject, Injectable, Optional } from "@nestjs/common";
import { assertPaypalCredentials } from "../../common/payment-credentials";
import { redactPaymentSecrets } from "../../common/payment-crypto";
import { EntitlementException } from "../../common/errors";
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
import { officialPaypalBase, paymentFetchJson, paypalAllowedHosts } from "./payment-http";
import {
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";

const TOKEN_SKEW_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

@Injectable()
export class PaypalPaymentAdapter implements PaymentAdapter {
  readonly provider = "paypal" as const;
  private readonly tokens = new Map<string, CachedToken>();

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
    const creds = assertPaypalCredentials(input.config.credentials);
    const returnUrl = input.returnUrl || creds.returnUrl;
    const cancelUrl = creds.cancelUrl || returnUrl;
    if (!returnUrl || !cancelUrl) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "PayPal checkout requires returnUrl (order or credentials) and cancelUrl",
      );
    }
    const value = majorFromMinor(input.amountCents, input.currency);
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: input.orderId,
          invoice_id: input.attemptId,
          amount: { currency_code: input.currency.toUpperCase(), value },
        },
      ],
      application_context: {
        user_action: "PAY_NOW",
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    };
    const created = requireBody(
      await this.api(input.config, creds, "POST", "/v2/checkout/orders", body, {
        "PayPal-Request-Id": input.attemptId,
      }),
      "PayPal create order returned an empty body",
    );
    const id = stringField(created, "id");
    const links = Array.isArray(created.links) ? created.links : [];
    const approve = links.find(
      (item) => item && typeof item === "object" && (item as { rel?: string }).rel === "approve",
    ) as { href?: string } | undefined;
    if (!id || !approve?.href) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "PayPal create order did not return an approve URL",
      );
    }
    return {
      provider: this.provider,
      providerRef: id,
      status: "pending",
      checkoutUrl: approve.href,
      qrPayload: null,
      action: { type: "redirect", attemptId: input.attemptId, paypalOrderId: id },
    };
  }

  async completeCheckout(input: CompleteCheckoutInput): Promise<PaymentQueryResult> {
    const creds = assertPaypalCredentials(input.config.credentials);
    const captured = requireBody(
      await this.api(
        input.config,
        creds,
        "POST",
        `/v2/checkout/orders/${encodeURIComponent(input.providerRef)}/capture`,
        {},
      ),
      "PayPal capture returned an empty body",
    );
    return this.queryFromOrderPayload(captured, input.config, creds, input.providerRef);
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Record<string, string>,
    config: ProviderConfig,
  ): Promise<VerifiedWebhook> {
    const creds = assertPaypalCredentials(config.credentials);
    const transmission = {
      auth_algo: header(headers, "paypal-auth-algo"),
      cert_url: header(headers, "paypal-cert-url"),
      transmission_id: header(headers, "paypal-transmission-id"),
      transmission_sig: header(headers, "paypal-transmission-sig"),
      transmission_time: header(headers, "paypal-transmission-time"),
    };
    if (Object.values(transmission).some((value) => !value)) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "PayPal webhook is missing required transmission headers",
      );
    }
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(rawBody).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not object");
      }
      event = parsed as Record<string, unknown>;
    } catch {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "PayPal webhook JSON is invalid");
    }
    const verify = requireBody(
      await this.api(config, creds, "POST", "/v1/notifications/verify-webhook-signature", {
        ...transmission,
        webhook_id: creds.webhookId,
        webhook_event: event,
      }),
      "PayPal webhook verification returned an empty body",
    );
    if (stringField(verify, "verification_status") !== "SUCCESS") {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "PayPal webhook signature was rejected",
      );
    }
    return this.mapVerifiedEvent(event, config, creds);
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const creds = assertPaypalCredentials(config.credentials);
    const orderLookup = await this.api(
      config,
      creds,
      "GET",
      `/v2/checkout/orders/${encodeURIComponent(providerRef)}`,
      undefined,
      undefined,
      { allowNotFound: true },
    );
    if (orderLookup) {
      const status = stringField(orderLookup, "status");
      if (status === "APPROVED") {
        const captured = requireBody(
          await this.api(
            config,
            creds,
            "POST",
            `/v2/checkout/orders/${encodeURIComponent(providerRef)}/capture`,
            {},
          ),
          "PayPal capture returned an empty body",
        );
        return this.queryFromOrderPayload(captured, config, creds, providerRef);
      }
      return this.queryFromOrderPayload(orderLookup, config, creds, providerRef);
    }
    const capture = requireBody(
      await this.api(
        config,
        creds,
        "GET",
        `/v2/payments/captures/${encodeURIComponent(providerRef)}`,
      ),
      "PayPal capture query returned an empty body",
    );
    return this.queryFromCapture(capture, config, creds, providerRef);
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertPaypalCredentials(config.credentials);
    let captureId = input.providerRef;
    const order = await this.api(
      config,
      creds,
      "GET",
      `/v2/checkout/orders/${encodeURIComponent(input.providerRef)}`,
      undefined,
      undefined,
      { allowNotFound: true },
    );
    if (order) captureId = captureIdFromOrder(order) || captureId;
    const refunded = requireBody(
      await this.api(
        config,
        creds,
        "POST",
        `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
        {
          amount: {
            currency_code: input.currency.toUpperCase(),
            value: majorFromMinor(input.amountCents, input.currency),
          },
        },
        { "PayPal-Request-Id": input.idempotencyKey },
      ),
      "PayPal refund returned an empty body",
    );
    const status = stringField(refunded, "status");
    return {
      providerRef: stringField(refunded, "id") || input.idempotencyKey,
      status: status === "COMPLETED" ? "succeeded" : status === "FAILED" ? "failed" : "pending",
      amountCents: input.amountCents,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      apiBase: officialPaypalBase(config.environment),
      remoteTested: false,
    };
    try {
      const creds = assertPaypalCredentials(config.credentials);
      diagnostics.clientIdLastFour = creds.clientId.slice(-4);
      diagnostics.webhookIdLastFour = creds.webhookId.slice(-4);
      diagnostics.subscriptionCheckout = false;
      diagnostics.subscriptionWebhookMapped = subscriptionWebhooksEnabled(creds);
      if (opts?.remote) {
        await this.accessToken(config, creds);
        diagnostics.remoteTested = true;
        diagnostics.tokenCached = true;
      }
    } catch (err) {
      issues.push(err instanceof Error ? err.message : "credential_invalid");
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("paypal"),
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private mapVerifiedEvent(
    event: Record<string, unknown>,
    config: ProviderConfig,
    creds: ReturnType<typeof assertPaypalCredentials>,
  ): VerifiedWebhook {
    const eventType = stringField(event, "event_type");
    const eventId = stringField(event, "id");
    const resource =
      event.resource && typeof event.resource === "object" && !Array.isArray(event.resource)
        ? (event.resource as Record<string, unknown>)
        : {};
    const ack = { status: 200, body: { received: true } };
    if (eventType === "CHECKOUT.ORDER.APPROVED") {
      return {
        eventId,
        orderId: stringField(resource, "custom_id") || customIdFromOrder(resource),
        attemptId: invoiceIdFromOrder(resource),
        providerRef: stringField(resource, "id"),
        status: "ignored",
        amountCents: 0,
        currency: config.currencies[0] ?? "USD",
        payload: redactPaymentSecrets({ eventType, reason: "approval_is_not_capture" }),
        ack,
      };
    }
    if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      const amount = amountFromResource(resource);
      return {
        eventId,
        orderId: stringField(resource, "custom_id") || customIdFromOrder(resource),
        attemptId: stringField(resource, "invoice_id"),
        providerRef: stringField(resource, "id"),
        status: "succeeded",
        amountCents: amount.amountCents,
        currency: amount.currency,
        merchantId: payeeMerchant(resource) || config.merchantId || creds.clientId,
        payload: redactPaymentSecrets({ eventType, captureId: stringField(resource, "id") }),
        ack,
      };
    }
    if (eventType === "PAYMENT.CAPTURE.DENIED") {
      const amount = amountFromResource(resource);
      return {
        eventId,
        orderId: stringField(resource, "custom_id"),
        attemptId: stringField(resource, "invoice_id"),
        providerRef: stringField(resource, "id"),
        status: "failed",
        amountCents: amount.amountCents,
        currency: amount.currency,
        merchantId: config.merchantId || creds.clientId,
        payload: redactPaymentSecrets({ eventType }),
        ack,
      };
    }
    if (eventType === "PAYMENT.CAPTURE.REFUNDED") {
      return {
        eventId,
        orderId: stringField(resource, "custom_id"),
        attemptId: stringField(resource, "invoice_id"),
        providerRef: stringField(resource, "id"),
        status: "ignored",
        amountCents: 0,
        currency: config.currencies[0] ?? "USD",
        payload: redactPaymentSecrets({ eventType, reason: "refund_via_admin_path" }),
        ack,
      };
    }
    if (subscriptionWebhooksEnabled(creds) && isSubscriptionPaymentEvent(eventType)) {
      const amount = amountFromResource(resource);
      return {
        eventId,
        orderId: stringField(resource, "custom") || stringField(resource, "custom_id"),
        attemptId: stringField(resource, "invoice_id"),
        providerRef: stringField(resource, "id"),
        status: "pending",
        requiresQuery: true,
        amountCents: amount.amountCents,
        currency: amount.currency,
        merchantId: config.merchantId || creds.clientId,
        payload: redactPaymentSecrets({
          eventType,
          reason: "subscription_event_requires_query",
          planIdConfigured: Boolean(creds.paypalPlanId),
        }),
        ack,
      };
    }
    return {
      eventId: eventId || `ignored_${eventType}`,
      orderId: "",
      providerRef: stringField(resource, "id"),
      status: "ignored",
      amountCents: 0,
      currency: config.currencies[0] ?? "USD",
      payload: redactPaymentSecrets({ eventType, reason: "unmapped_event" }),
      ack,
    };
  }

  private queryFromOrderPayload(
    order: Record<string, unknown>,
    config: ProviderConfig,
    creds: ReturnType<typeof assertPaypalCredentials>,
    fallbackRef: string,
  ): PaymentQueryResult {
    const status = stringField(order, "status");
    const capture = firstCapture(order);
    if (status === "COMPLETED" && capture && stringField(capture, "status") === "COMPLETED") {
      return this.queryFromCapture(
        capture,
        config,
        creds,
        stringField(capture, "id") || fallbackRef,
      );
    }
    if (status === "VOIDED" || status === "EXPIRED") {
      return {
        providerRef: fallbackRef,
        status: status === "EXPIRED" ? "expired" : "canceled",
        amountCents: 0,
        currency: config.currencies[0] ?? "USD",
        merchantId: config.merchantId,
      };
    }
    const unit = firstPurchaseUnit(order);
    const amount = amountFromResource(unit ?? {});
    return {
      providerRef: fallbackRef,
      orderId: stringField(unit ?? {}, "custom_id") || null,
      attemptId: stringField(unit ?? {}, "invoice_id") || null,
      status: "pending",
      amountCents: amount.amountCents,
      currency: amount.currency || (config.currencies[0] ?? "USD"),
      merchantId: config.merchantId || creds.clientId,
    };
  }

  private queryFromCapture(
    capture: Record<string, unknown>,
    config: ProviderConfig,
    creds: ReturnType<typeof assertPaypalCredentials>,
    providerRef: string,
  ): PaymentQueryResult {
    const status = stringField(capture, "status");
    const amount = amountFromResource(capture);
    const mapped =
      status === "COMPLETED"
        ? "succeeded"
        : status === "DECLINED" || status === "FAILED"
          ? "failed"
          : "pending";
    return {
      providerRef,
      orderId: stringField(capture, "custom_id") || null,
      attemptId: stringField(capture, "invoice_id") || null,
      status: mapped,
      amountCents: amount.amountCents,
      currency: amount.currency,
      merchantId: payeeMerchant(capture) || config.merchantId || creds.clientId,
    };
  }

  private async accessToken(
    config: ProviderConfig,
    creds: ReturnType<typeof assertPaypalCredentials>,
  ): Promise<string> {
    const cacheKey = `${config.environment}:${creds.clientId}`;
    const cached = this.tokens.get(cacheKey);
    if (cached && cached.expiresAtMs > this.now().getTime() + TOKEN_SKEW_MS) {
      return cached.accessToken;
    }
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
    const { status, json } = await paymentFetchJson(
      this.fetchFn(),
      `${officialPaypalBase(config.environment)}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      },
      { allowedHosts: paypalAllowedHosts() },
    );
    const payload = asObject(json);
    const token = stringField(payload, "access_token");
    const expiresIn = Number(payload.expires_in);
    if (status >= 400 || !token) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "PayPal OAuth token request failed",
      );
    }
    this.tokens.set(cacheKey, {
      accessToken: token,
      expiresAtMs: this.now().getTime() + Math.max(30, expiresIn || 300) * 1000,
    });
    return token;
  }

  private async api(
    config: ProviderConfig,
    creds: ReturnType<typeof assertPaypalCredentials>,
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
    opts?: { allowNotFound?: boolean },
  ): Promise<Record<string, unknown> | null> {
    const token = await this.accessToken(config, creds);
    const { status, json, text } = await paymentFetchJson(
      this.fetchFn(),
      `${officialPaypalBase(config.environment)}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
          ...(extraHeaders ?? {}),
        },
        body: method === "GET" || body === undefined ? undefined : JSON.stringify(body ?? {}),
      },
      { allowedHosts: paypalAllowedHosts() },
    );
    if (opts?.allowNotFound && status === 404) return null;
    if (status >= 400) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        `PayPal API ${method} ${path} failed`,
        { details: { status, bodyLength: text.length } },
      );
    }
    return asObject(json);
  }
}

function requireBody(
  value: Record<string, unknown> | null,
  message: string,
): Record<string, unknown> {
  if (!value) {
    throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", message);
  }
  return value;
}

function header(headers: Record<string, string>, name: string): string {
  return headers[name] ?? headers[name.toUpperCase()] ?? "";
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function majorFromMinor(amountCents: number, currency: string): string {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "PayPal amount must be a positive integer minor unit",
    );
  }
  if (!/^[A-Z]{3}$/.test(currency.toUpperCase())) {
    throw new EntitlementException("PAYMENT_AMOUNT_MISMATCH", "PayPal currency is invalid");
  }
  return (amountCents / 100).toFixed(2);
}

function minorFromMajor(
  value: string,
  currency: string,
): { amountCents: number; currency: string } {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "PayPal amount is not a strict decimal",
    );
  }
  const [whole, frac = ""] = trimmed.split(".");
  return {
    amountCents: Number(whole) * 100 + Number(frac.padEnd(2, "0")),
    currency: currency.toUpperCase(),
  };
}

function amountFromResource(resource: Record<string, unknown>): {
  amountCents: number;
  currency: string;
} {
  const amount =
    resource.amount && typeof resource.amount === "object"
      ? (resource.amount as Record<string, unknown>)
      : resource;
  const value = stringField(amount, "value") || stringField(amount, "total");
  const currency = stringField(amount, "currency_code") || stringField(amount, "currency") || "USD";
  if (!value) return { amountCents: 0, currency };
  return minorFromMajor(value, currency);
}

function firstPurchaseUnit(order: Record<string, unknown>): Record<string, unknown> | null {
  const units = order.purchase_units;
  if (!Array.isArray(units) || !units[0] || typeof units[0] !== "object") return null;
  return units[0] as Record<string, unknown>;
}

function firstCapture(order: Record<string, unknown>): Record<string, unknown> | null {
  const unit = firstPurchaseUnit(order);
  const payments =
    unit?.payments && typeof unit.payments === "object"
      ? (unit.payments as Record<string, unknown>)
      : null;
  const captures = payments?.captures;
  if (!Array.isArray(captures) || !captures[0] || typeof captures[0] !== "object") return null;
  return captures[0] as Record<string, unknown>;
}

function captureIdFromOrder(order: Record<string, unknown>): string {
  return stringField(firstCapture(order) ?? {}, "id");
}

function customIdFromOrder(order: Record<string, unknown>): string {
  return stringField(firstPurchaseUnit(order) ?? {}, "custom_id");
}

function invoiceIdFromOrder(order: Record<string, unknown>): string {
  return stringField(firstPurchaseUnit(order) ?? {}, "invoice_id");
}

function payeeMerchant(resource: Record<string, unknown>): string {
  const payee =
    resource.payee && typeof resource.payee === "object"
      ? (resource.payee as Record<string, unknown>)
      : {};
  return stringField(payee, "merchant_id");
}

function subscriptionWebhooksEnabled(creds: ReturnType<typeof assertPaypalCredentials>): boolean {
  return (
    creds.subscriptionWebhookEnabled === "true" ||
    Boolean(creds.paypalPlanId) ||
    Boolean(creds.paypalProductId)
  );
}

function isSubscriptionPaymentEvent(eventType: string): boolean {
  return (
    eventType === "PAYMENT.SALE.COMPLETED" ||
    eventType === "BILLING.SUBSCRIPTION.UPDATED" ||
    eventType === "BILLING.SUBSCRIPTION.ACTIVATED"
  );
}
