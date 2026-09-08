import { Inject, Injectable, Optional } from "@nestjs/common";
import { hmacSha256Base64, hmacSha256Hex, safeEqualString } from "../../common/crypto";
import { EntitlementException } from "../../common/errors";
import { assertBitpayCredentials } from "../../common/payment-credentials";
import { redactPaymentSecrets } from "../../common/payment-crypto";
import { defaultCapabilities, type ProviderCapabilities } from "../../common/payment-providers";
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
  defaultBitpayMerchantFactory,
  officialBitpaySdkAvailable,
  type BitpayMerchantFactory,
} from "./bitpay-sdk";
import { bitpayAllowedHosts, officialBitpayBase, paymentFetchJson } from "./payment-http";
import {
  BITPAY_MERCHANT_FACTORY,
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";

@Injectable()
export class BitpayPaymentAdapter implements PaymentAdapter {
  readonly provider = "bitpay" as const;

  constructor(
    @Optional() @Inject(PAYMENT_FETCH) private readonly fetchImpl?: PaymentFetch,
    @Optional() @Inject(PAYMENT_CLOCK) private readonly clock?: PaymentClock,
    @Optional()
    @Inject(BITPAY_MERCHANT_FACTORY)
    private readonly merchantFactory?: BitpayMerchantFactory,
  ) {}

  private fetchFn(): PaymentFetch {
    return this.fetchImpl ?? defaultPaymentFetch();
  }

  private now(): Date {
    return (this.clock ?? defaultPaymentClock).now();
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const creds = assertBitpayCredentials(input.config.credentials);
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "BitPay amount must be a positive integer minor unit",
      );
    }
    const body = {
      token: creds.posToken,
      price: input.amountCents / 100,
      currency: input.currency.toUpperCase(),
      orderId: input.orderId,
      posData: JSON.stringify({ orderId: input.orderId, attemptId: input.attemptId }),
      notificationURL: creds.notificationUrl,
      redirectURL: input.returnUrl || creds.redirectUrl,
      transactionSpeed: "medium",
      extendedNotifications: true,
    };
    const created = unwrapData(await this.api(input.config, "POST", "/invoices", body));
    const id = stringField(created, "id");
    const url = stringField(created, "url");
    if (!id || !url) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "BitPay did not return an invoice URL",
      );
    }
    this.assertOfficialInvoiceUrl(url, input.config.environment);
    return {
      provider: this.provider,
      providerRef: id,
      status: "pending",
      checkoutUrl: url,
      qrPayload: null,
      action: { type: "redirect", attemptId: input.attemptId, invoiceId: id },
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
    const creds = assertBitpayCredentials(config.credentials);
    if (creds.ipnHmacSecret) {
      verifyBitpayHmac(rawBody, headers, creds.ipnHmacSecret);
    }
    const payload = parseJsonObject(rawBody);
    const data = nestedObject(payload, "data") ?? payload;
    const event = nestedObject(payload, "event");
    const invoiceId = stringField(data, "id") || stringField(payload, "id");
    const status = stringField(data, "status") || stringField(payload, "status");
    const eventName = event ? stringField(event, "name") : "";
    const eventCode = event ? stringField(event, "code") : "";
    const eventId = `${invoiceId}:${status || eventName || "ipn"}:${eventCode || "0"}`;
    const pos = parsePosData(stringField(data, "posData"));
    const ack = { status: 200, body: "Success", contentType: "text/plain" };
    return {
      eventId,
      orderId: stringField(data, "orderId") || pos.orderId,
      attemptId: pos.attemptId || null,
      providerRef: invoiceId,
      status: "pending",
      requiresQuery: true,
      amountCents: 0,
      currency: stringField(data, "currency") || config.currencies[0] || "USD",
      merchantId: config.merchantId,
      payload: redactPaymentSecrets({
        ipnStatus: status,
        eventName,
        receivedAt: this.now().toISOString(),
        hmacVerified: Boolean(creds.ipnHmacSecret),
      }),
      ack,
    };
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const creds = assertBitpayCredentials(config.credentials);
    const invoice = unwrapData(
      await this.api(
        config,
        "GET",
        `/invoices/${encodeURIComponent(providerRef)}?token=${encodeURIComponent(creds.posToken)}`,
      ),
    );
    const statusRaw = stringField(invoice, "status").toLowerCase();
    const price = invoice.price;
    const currency = stringField(invoice, "currency").toUpperCase();
    const amountCents =
      typeof price === "number" && Number.isFinite(price)
        ? Math.round(price * 100)
        : typeof price === "string"
          ? minorFromMajor(price)
          : 0;
    const pos = parsePosData(stringField(invoice, "posData"));
    const mapped =
      statusRaw === "complete"
        ? "succeeded"
        : statusRaw === "invalid" || statusRaw === "expired"
          ? statusRaw === "expired"
            ? "expired"
            : "failed"
          : "pending";
    return {
      providerRef: stringField(invoice, "id") || providerRef,
      orderId: stringField(invoice, "orderId") || pos.orderId || null,
      attemptId: pos.attemptId || null,
      status: mapped,
      amountCents,
      currency,
      merchantId: config.merchantId || stringField(invoice, "token") || creds.posToken.slice(-8),
    };
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertBitpayCredentials(config.credentials);
    if (!creds.merchantToken || !creds.privateKey) {
      throw new EntitlementException(
        "PAYMENT_REFUND_UNSUPPORTED",
        "BitPay refunds require official bitpay-sdk signing with privateKey and merchantToken; token-only refunds are not supported",
      );
    }
    const factory = this.merchantFactory ?? defaultBitpayMerchantFactory();
    const client = await factory({
      privateKey: creds.privateKey,
      merchantToken: creds.merchantToken,
      environment: config.environment,
    });
    const result = await client.createRefund({
      invoiceId: input.providerRef,
      amountMajor: input.amountCents / 100,
      currency: input.currency.toUpperCase(),
      merchantToken: creds.merchantToken,
      guid: input.idempotencyKey,
    });
    const statusRaw = result.status.toLowerCase();
    const status =
      statusRaw === "success" || statusRaw === "complete"
        ? "succeeded"
        : statusRaw === "failure" || statusRaw === "failed"
          ? "failed"
          : "pending";
    const amount =
      typeof result.amount === "number" ? Math.round(result.amount * 100) : input.amountCents;
    return {
      providerRef: result.id || input.providerRef,
      status,
      amountCents: amount,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const capabilities: ProviderCapabilities = {
      ...defaultCapabilities("bitpay"),
    };
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      apiBase: officialBitpayBase(config.environment),
      remoteTested: false,
      requiresQueryBeforeFulfill: true,
      ipnUnsignedByDefault: true,
      refundSigning: "bitpay-sdk",
    };
    try {
      const creds = assertBitpayCredentials(config.credentials);
      const sdk = officialBitpaySdkAvailable();
      capabilities.refund = Boolean(creds.merchantToken && creds.privateKey && sdk.ok);
      diagnostics.posTokenLastFour = creds.posToken.slice(-4);
      diagnostics.refund = capabilities.refund;
      diagnostics.officialSdk = sdk.ok;
      diagnostics.merchantTokenPresent = Boolean(creds.merchantToken);
      diagnostics.privateKeyPresent = Boolean(creds.privateKey);
      diagnostics.hmacIpn = Boolean(creds.ipnHmacSecret);
      if (opts?.remote) {
        await this.api(config, "GET", `/invoices?token=${encodeURIComponent(creds.posToken)}`);
        diagnostics.remoteTested = true;
      }
    } catch (err) {
      issues.push(err instanceof Error ? err.message : "credential_invalid");
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities,
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private async api(
    config: ProviderConfig,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = `${officialBitpayBase(config.environment)}${path}`;
    const { status, json, text } = await paymentFetchJson(
      this.fetchFn(),
      url,
      {
        method,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-accept-version": "2.0.0",
        },
        body: method === "GET" || body === undefined ? undefined : JSON.stringify(body),
      },
      { allowedHosts: bitpayAllowedHosts() },
    );
    if (status >= 400) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        `BitPay API ${method} ${path.split("?")[0]} failed`,
        { details: { status, bodyLength: text.length } },
      );
    }
    if (!json || typeof json !== "object") {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "BitPay API returned an empty body",
      );
    }
    return json as Record<string, unknown>;
  }

  private assertOfficialInvoiceUrl(url: string, environment: "sandbox" | "live"): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "BitPay invoice URL is malformed",
      );
    }
    if (parsed.protocol !== "https:") {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "BitPay invoice URL must be HTTPS",
      );
    }
    const host = parsed.hostname.toLowerCase();
    const expected = environment === "live" ? "bitpay.com" : "test.bitpay.com";
    if (host !== expected && !host.endsWith(`.${expected}`)) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "BitPay invoice host is not an official endpoint",
      );
    }
  }
}

export function verifyBitpayHmac(
  rawBody: Uint8Array,
  headers: Record<string, string>,
  secret: string,
): void {
  const provided = header(headers, "x-signature");
  if (!provided) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "BitPay x-signature header is required",
    );
  }
  const raw = Buffer.from(rawBody);
  const bodies = [raw];
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    bodies.push(Buffer.from(JSON.stringify(parsed), "utf8"));
  } catch {
    // raw-body candidate still compared when JSON is invalid
  }
  const candidates = bodies.flatMap((body) => [
    hmacSha256Base64(secret, body),
    hmacSha256Hex(secret, body),
  ]);
  if (!candidates.some((expected) => safeEqualString(expected, provided))) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "BitPay IPN HMAC mismatch");
  }
}

function unwrapData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = payload.data;
  if (data && typeof data === "object" && !Array.isArray(data))
    return data as Record<string, unknown>;
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    return data[0] as Record<string, unknown>;
  }
  return payload;
}

function parseJsonObject(rawBody: Uint8Array): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "BitPay IPN JSON is invalid");
  }
}

function nestedObject(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parsePosData(raw: string): { orderId: string; attemptId: string } {
  if (!raw) return { orderId: "", attemptId: "" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      return {
        orderId: typeof rec.orderId === "string" ? rec.orderId : "",
        attemptId: typeof rec.attemptId === "string" ? rec.attemptId : "",
      };
    }
  } catch {
    return { orderId: "", attemptId: "" };
  }
  return { orderId: "", attemptId: "" };
}

function header(headers: Record<string, string>, name: string): string {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] ?? "";
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function minorFromMajor(value: string): number {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "BitPay amount is not a strict decimal",
    );
  }
  const [whole, frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
