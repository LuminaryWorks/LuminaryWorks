import { Inject, Injectable, Optional } from "@nestjs/common";
import { safeEqualString } from "../../common/crypto";
import { EntitlementException } from "../../common/errors";
import { assertDoerflowCreditCredentials } from "../../common/payment-credentials";
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
import { paymentFetchJson } from "./payment-http";
import {
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";
import {
  assertLedgerAmountMatch,
  computeDoerflowWebhookSignature,
  deriveChargeEventId,
  deriveChargeIdempotencyKey,
  DOERFLOW_WEBHOOK_REPLAY_WINDOW_SECONDS,
  joinDoerflowUrl,
  ledgerAmountMinorToCents,
  MERCHANT_CHARGE_EVENT_TYPE,
  toLedgerAmountMinor,
  type MerchantChargeRejectCode,
  type MerchantChargeRequest,
} from "./doerflow-credit";

type CachedCharge = {
  orderId: string;
  attemptId: string;
  amountMinor: string;
  currency: string;
  merchantAccount: string;
  idempotencyKey: string;
  eventId: string;
};

@Injectable()
export class DoerflowCreditPaymentAdapter implements PaymentAdapter {
  readonly provider = "doerflow_credit" as const;
  private readonly charges = new Map<string, CachedCharge>();
  private readonly seenNonces = new Map<string, number>();

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
    const creds = assertDoerflowCreditCredentials(input.config.credentials);
    this.assertLiveHttps(creds.baseUrl, input.config.environment);
    const subjectId = input.subjectId?.trim() || stringFromMetadata(input.metadata, "subjectId");
    if (!subjectId) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "doerflow_credit checkout requires subjectId",
      );
    }
    const amountMinor = toLedgerAmountMinor(input.amountCents);
    const idempotencyKey = deriveChargeIdempotencyKey(input.orderId, input.attemptId);
    const expectedEventId = deriveChargeEventId(idempotencyKey);
    const body: MerchantChargeRequest = {
      orderId: input.orderId,
      subjectId,
      asset: creds.asset,
      chainId: creds.chainId,
      amountMinor,
      currency: input.currency.toUpperCase(),
      idempotencyKey,
      metadata: { attemptId: input.attemptId },
    };
    const { status, json } = await this.api(
      input.config,
      creds,
      "POST",
      "/api/v1/payments/merchant/charges",
      body,
    );
    this.throwIfChargeRejected(status, json);
    const result = asObject(json);
    if (stringField(result, "status") !== "succeeded") {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "DoerFlow merchant charge did not succeed",
      );
    }
    const chargeId = stringField(result, "chargeId");
    if (!chargeId) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "DoerFlow merchant charge did not return a chargeId",
      );
    }
    const remoteEventId = stringField(result, "eventId");
    if (remoteEventId && remoteEventId !== expectedEventId) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "DoerFlow eventId does not match the derived idempotency event",
      );
    }
    const cached: CachedCharge = {
      orderId: input.orderId,
      attemptId: input.attemptId,
      amountMinor,
      currency: input.currency.toUpperCase(),
      merchantAccount: creds.merchantAccount,
      idempotencyKey,
      eventId: expectedEventId,
    };
    this.charges.set(chargeId, cached);
    this.charges.set(input.orderId, cached);
    return {
      provider: this.provider,
      providerRef: chargeId,
      status: "pending",
      checkoutUrl: null,
      qrPayload: null,
      action: {
        type: "ledger_debit",
        chargeId,
        ledgerOpId: stringField(result, "ledgerOpId") || null,
        eventId: expectedEventId,
        attemptId: input.attemptId,
        amountMinor,
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
    const creds = assertDoerflowCreditCredentials(config.credentials);
    this.verifyLwSignature(rawBody, headers, creds.webhookSecret, config.id);
    const payload = parseJsonAfterVerify(rawBody);
    const eventType = stringField(payload, "eventType");
    const ack = { status: 200, body: { received: true } };
    if (eventType && eventType !== MERCHANT_CHARGE_EVENT_TYPE) {
      return {
        eventId: stringField(payload, "eventId") || `dfc_ignored_${config.id}`,
        orderId: stringField(payload, "orderId"),
        providerRef: stringField(payload, "chargeId") || stringField(payload, "eventId"),
        status: "ignored",
        amountCents: 0,
        currency: stringField(payload, "currency") || config.currencies[0] || "USD",
        payload: redactPaymentSecrets(payload),
        ack,
      };
    }
    const orderId = stringField(payload, "orderId");
    const chargeId = stringField(payload, "chargeId");
    const eventId = stringField(payload, "eventId");
    const amountMinor = stringField(payload, "amountMinor");
    const currency = stringField(payload, "currency").toUpperCase();
    const merchantAccount = stringField(payload, "merchantAccount");
    if (!orderId || !chargeId || !eventId) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "DoerFlow webhook is missing orderId, chargeId, or eventId",
      );
    }
    if (!/^dfc_[0-9a-f]{32}$/.test(eventId)) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "DoerFlow eventId is malformed");
    }
    if (merchantAccount !== creds.merchantAccount) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "DoerFlow merchantAccount does not match provider credentials",
      );
    }
    if (config.merchantId && merchantAccount !== config.merchantId) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "DoerFlow merchantAccount does not match the order snapshot",
      );
    }
    const cached = this.charges.get(orderId) ?? this.charges.get(chargeId);
    if (cached) {
      assertLedgerAmountMatch(cached.amountMinor, amountMinor);
      if (cached.currency !== currency) {
        throw new EntitlementException(
          "PAYMENT_AMOUNT_MISMATCH",
          "DoerFlow currency does not match the order snapshot",
        );
      }
      if (cached.merchantAccount !== merchantAccount) {
        throw new EntitlementException(
          "PAYMENT_AMOUNT_MISMATCH",
          "DoerFlow merchantAccount does not match the order snapshot",
        );
      }
      if (eventId !== cached.eventId && eventId !== deriveChargeEventId(cached.idempotencyKey)) {
        throw new EntitlementException(
          "PAYMENT_WEBHOOK_INVALID",
          "DoerFlow eventId does not match the derived idempotency event",
        );
      }
    }
    const amountCents = ledgerAmountMinorToCents(amountMinor);
    const statusRaw = stringField(payload, "status");
    const status =
      statusRaw === "succeeded" ? "succeeded" : statusRaw === "pending" ? "pending" : "failed";
    return {
      eventId,
      orderId,
      attemptId: cached?.attemptId ?? null,
      providerRef: chargeId,
      status,
      amountCents,
      currency,
      merchantId: merchantAccount,
      payload: redactPaymentSecrets(payload),
      ack,
    };
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const creds = assertDoerflowCreditCredentials(config.credentials);
    this.assertLiveHttps(creds.baseUrl, config.environment);
    const { status, json } = await this.api(
      config,
      creds,
      "GET",
      `/api/v1/payments/merchant/charges/${encodeURIComponent(providerRef)}`,
    );
    if (status === 404) {
      return {
        providerRef,
        status: "pending",
        amountCents: 0,
        currency: config.currencies[0] ?? "USD",
        merchantId: creds.merchantAccount,
      };
    }
    if (status >= 400) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "DoerFlow merchant charge query failed",
      );
    }
    const result = asObject(json);
    const amountMinor = stringField(result, "amountMinor");
    const currency = stringField(result, "currency").toUpperCase() || config.currencies[0] || "USD";
    const remoteStatus = stringField(result, "status");
    const mapped =
      remoteStatus === "succeeded"
        ? "succeeded"
        : remoteStatus === "insufficient_funds" || remoteStatus === "failed"
          ? "failed"
          : "pending";
    return {
      providerRef: stringField(result, "chargeId") || providerRef,
      orderId: stringField(result, "orderId") || null,
      status: mapped,
      amountCents: amountMinor ? ledgerAmountMinorToCents(amountMinor) : 0,
      currency,
      merchantId: stringField(result, "merchantAccount") || creds.merchantAccount,
    };
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertDoerflowCreditCredentials(config.credentials);
    this.assertLiveHttps(creds.baseUrl, config.environment);
    const amountMinor = toLedgerAmountMinor(input.amountCents);
    const { status, json } = await this.api(
      config,
      creds,
      "POST",
      "/api/v1/payments/merchant/refunds",
      {
        orderId: input.orderId,
        chargeId: input.providerRef,
        amountMinor,
        currency: input.currency.toUpperCase(),
        idempotencyKey: input.idempotencyKey,
      },
    );
    this.throwIfChargeRejected(status, json);
    const result = asObject(json);
    const remoteStatus = stringField(result, "status");
    return {
      providerRef: stringField(result, "refundId") || input.idempotencyKey,
      status:
        remoteStatus === "succeeded"
          ? "succeeded"
          : remoteStatus === "failed"
            ? "failed"
            : "pending",
      amountCents: input.amountCents,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      remoteTested: false,
      hostedCheckout: false,
    };
    try {
      const creds = assertDoerflowCreditCredentials(config.credentials);
      this.assertLiveHttps(creds.baseUrl, config.environment);
      diagnostics.apiBaseHost = new URL(creds.baseUrl).hostname;
      diagnostics.asset = creds.asset;
      diagnostics.chainId = creds.chainId;
      diagnostics.merchantAccountLastFour = creds.merchantAccount.slice(-4);
      diagnostics.serviceKeyLastFour = creds.serviceKey.slice(-4);
      diagnostics.webhookSecretLastFour = creds.webhookSecret.slice(-4);
      if (opts?.remote) {
        const { status } = await this.api(config, creds, "GET", "/api/v1/payments/merchant/health");
        if (status >= 400) {
          issues.push("remote_health_failed");
        } else {
          diagnostics.remoteTested = true;
        }
      }
    } catch (err) {
      issues.push(err instanceof Error ? err.message : "credential_invalid");
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("doerflow_credit"),
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private verifyLwSignature(
    rawBody: Uint8Array,
    headers: Record<string, string>,
    secret: string,
    configId: string,
  ): void {
    const timestamp = header(headers, "x-lw-timestamp");
    const nonce = header(headers, "x-lw-nonce");
    const signature = header(headers, "x-lw-signature");
    if (!timestamp || !nonce || !signature) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "DoerFlow webhook is missing x-lw-timestamp, x-lw-nonce, or x-lw-signature",
      );
    }
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "DoerFlow webhook timestamp is invalid",
      );
    }
    const skew = Math.abs(Math.floor(this.now().getTime() / 1000) - ts);
    if (skew > DOERFLOW_WEBHOOK_REPLAY_WINDOW_SECONDS) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "DoerFlow webhook timestamp is outside the replay window",
      );
    }
    if (nonce.length < 8) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "DoerFlow webhook nonce is missing",
      );
    }
    if (!signature.startsWith("v1=")) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "DoerFlow webhook signature is missing or invalid",
      );
    }
    const expected = computeDoerflowWebhookSignature(secret, timestamp, nonce, rawBody);
    const provided = signature.slice("v1=".length);
    if (!safeEqualString(expected, provided)) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "DoerFlow webhook signature mismatch",
      );
    }
    const nonceKey = `${configId}:${nonce}`;
    const expiresAt = ts + DOERFLOW_WEBHOOK_REPLAY_WINDOW_SECONDS;
    const existing = this.seenNonces.get(nonceKey);
    if (existing && existing >= Math.floor(this.now().getTime() / 1000)) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "DoerFlow webhook nonce reused");
    }
    this.pruneNonces();
    this.seenNonces.set(nonceKey, expiresAt);
  }

  private pruneNonces(): void {
    const nowSec = Math.floor(this.now().getTime() / 1000);
    for (const [key, expiresAt] of this.seenNonces) {
      if (expiresAt < nowSec) this.seenNonces.delete(key);
    }
  }

  private assertLiveHttps(baseUrl: string, environment: "sandbox" | "live"): void {
    if (environment === "live" && new URL(baseUrl).protocol !== "https:") {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "doerflow_credit live environment requires an HTTPS baseUrl",
      );
    }
  }

  private throwIfChargeRejected(httpStatus: number, json: unknown): void {
    const payload = asObject(json);
    const code = stringField(payload, "code") as MerchantChargeRejectCode | "";
    const status = stringField(payload, "status");
    if (
      httpStatus === 402 ||
      status === "insufficient_funds" ||
      code === "LEDGER_INSUFFICIENT_FUNDS"
    ) {
      throw new EntitlementException(
        "LEDGER_INSUFFICIENT_FUNDS",
        "DoerFlow ledger available balance is insufficient",
      );
    }
    if (code === "INVALID_AMOUNT" || httpStatus === 409) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "DoerFlow rejected the charge amount",
      );
    }
    if (httpStatus >= 400) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "DoerFlow merchant charge failed",
      );
    }
  }

  private async api(
    config: ProviderConfig,
    creds: ReturnType<typeof assertDoerflowCreditCredentials>,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown; text: string }> {
    const url = joinDoerflowUrl(creds.baseUrl, path);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Service-Key": creds.serviceKey,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      return await paymentFetchJson(
        this.fetchFn(),
        url,
        {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        {
          allowedHosts: new Set([new URL(creds.baseUrl).hostname]),
          allowHttp: config.environment === "sandbox",
        },
      );
    } catch (err) {
      if (err instanceof EntitlementException) throw err;
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") {
        throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", "Payment gateway timed out");
      }
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "DoerFlow merchant request failed",
      );
    }
  }
}

function parseJsonAfterVerify(rawBody: Uint8Array): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "DoerFlow webhook JSON is invalid");
  }
}

function header(headers: Record<string, string>, name: string): string {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] ?? "";
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringFromMetadata(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}
