import { Injectable } from "@nestjs/common";
import { hmacSha256Hex, safeEqualString } from "../../common/crypto";
import { EntitlementException } from "../../common/errors";
import { defaultCapabilities, type ProviderId } from "../../common/payment-providers";
import type {
  CheckoutSession,
  CreateCheckoutInput,
  CreatePaymentInput,
  CreatePaymentResult,
  HealthStatus,
  PaymentAdapter,
  PaymentCallbackInput,
  PaymentCallbackResult,
  PaymentQueryResult,
  ProviderConfig,
  RefundInput,
  RefundResult,
  VerifiedWebhook,
} from "./payment-adapter";

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

function parseJsonAfterVerify(rawBody: Uint8Array): Record<string, unknown> {
  const text = Buffer.from(rawBody).toString("utf8");
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Webhook JSON must be an object");
  }
  return parsed as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value);
}

@Injectable()
export class MockPaymentAdapter implements PaymentAdapter {
  readonly provider = "mock";
  private readonly queries = new Map<string, PaymentQueryResult>();

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const providerRef = `mock_${input.attemptId}`;
    this.queries.set(providerRef, {
      providerRef,
      orderId: input.orderId,
      attemptId: input.attemptId,
      status: "pending",
      amountCents: input.amountCents,
      currency: input.currency,
      merchantId: input.config.merchantId,
    });
    return {
      provider: this.provider,
      providerRef,
      status: "pending",
      checkoutUrl: `https://pay.mock.invalid/checkout/${input.attemptId}`,
      qrPayload: `mock-qr:${input.attemptId}`,
      action: { type: "redirect", attemptId: input.attemptId },
    };
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Record<string, string>,
    config: ProviderConfig,
  ): Promise<VerifiedWebhook> {
    const secret = config.credentials.webhookSecret;
    if (!secret) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Mock webhook secret is missing");
    }
    const provided = headers[MOCK_SIGNATURE_HEADER] ?? headers["X-Mock-Signature"] ?? "";
    const expected = hmacSha256Hex(secret, Buffer.from(rawBody));
    if (!provided || !safeEqualString(provided, expected)) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Mock webhook signature mismatch");
    }
    const payload = parseJsonAfterVerify(rawBody);
    const statusRaw = asString(payload.status);
    const status =
      statusRaw === "failed" ? "failed" : statusRaw === "pending" ? "pending" : "succeeded";
    const providerRef = asString(payload.providerRef) || `mock_${asString(payload.attemptId)}`;
    if (status === "succeeded" || status === "failed") {
      const existing = this.queries.get(providerRef);
      if (existing) existing.status = status === "succeeded" ? "succeeded" : "failed";
    }
    return {
      eventId: asString(payload.eventId),
      orderId: asString(payload.orderId),
      attemptId: asString(payload.attemptId) || null,
      providerRef,
      status,
      amountCents: asInt(payload.amountCents),
      currency: asString(payload.currency),
      merchantId: asString(payload.merchantId) || config.merchantId,
      payload,
      ack: { status: 200, body: { received: true } },
    };
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const stored = this.queries.get(providerRef);
    if (stored) return { ...stored, merchantId: stored.merchantId ?? config.merchantId };
    return {
      providerRef,
      status: "pending",
      amountCents: 0,
      currency: "USD",
      merchantId: config.merchantId,
    };
  }

  markQuery(providerRef: string, patch: Partial<PaymentQueryResult>): void {
    const current = this.queries.get(providerRef);
    if (current) this.queries.set(providerRef, { ...current, ...patch });
  }

  async refund(input: RefundInput, _config: ProviderConfig): Promise<RefundResult> {
    return {
      providerRef: `mock_rf_${input.idempotencyKey}`,
      status: "succeeded",
      amountCents: input.amountCents,
    };
  }

  async healthCheck(config: ProviderConfig): Promise<HealthStatus> {
    const issues: string[] = [];
    if (!config.credentials.webhookSecret)
      issues.push("webhookSecret is required for mock webhooks");
    return { ok: issues.length === 0, issues, capabilities: defaultCapabilities("mock") };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return {
      provider: this.provider,
      providerRef: `mock_${input.orderId}`,
      status: "requires_action",
      raw: { simulated: true, checkout: true },
    };
  }

  async handleCallback(input: PaymentCallbackInput): Promise<PaymentCallbackResult> {
    const orderId = String(input.payload.orderId ?? "");
    const ok = input.payload.status !== "failed";
    return {
      orderId,
      providerRef: String(input.payload.providerRef ?? `mock_${orderId}`),
      status: ok ? "paid" : "failed",
      raw: input.payload,
    };
  }
}

@Injectable()
export class ManualPaymentAdapter implements PaymentAdapter {
  readonly provider = "manual";

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const instructions =
      typeof input.config.metadata.instructions === "string"
        ? input.config.metadata.instructions
        : "Awaiting admin confirmation of offline payment";
    return {
      provider: this.provider,
      providerRef: `manual_${input.attemptId}`,
      status: "requires_action",
      checkoutUrl: null,
      qrPayload: null,
      action: {
        type: "manual_instructions",
        confirmableBy: "admin",
        instructions,
      },
    };
  }

  async verifyWebhook(
    _rawBody: Uint8Array,
    _headers: Record<string, string>,
    _config: ProviderConfig,
  ): Promise<VerifiedWebhook> {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "Manual payments have no public webhook; admin confirmation is required",
    );
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    return {
      providerRef,
      status: "pending",
      amountCents: 0,
      currency: "USD",
      merchantId: config.merchantId,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      providerRef: `manual_rf_${input.idempotencyKey}`,
      status: "succeeded",
      amountCents: input.amountCents,
    };
  }

  async healthCheck(_config: ProviderConfig): Promise<HealthStatus> {
    return { ok: true, issues: [], capabilities: defaultCapabilities("manual") };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return {
      provider: this.provider,
      providerRef: `manual_${input.orderId}`,
      status: "requires_action",
      raw: { note: "Awaiting manual confirmation" },
    };
  }

  async handleCallback(input: PaymentCallbackInput): Promise<PaymentCallbackResult> {
    return {
      orderId: String(input.payload.orderId ?? ""),
      providerRef: String(input.payload.providerRef ?? ""),
      status: input.payload.status === "failed" ? "failed" : "paid",
      raw: input.payload,
    };
  }
}

@Injectable()
export class ContractPaymentAdapter implements PaymentAdapter {
  readonly provider = "contract";

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    return {
      provider: this.provider,
      providerRef: `contract_${input.attemptId}`,
      status: "requires_action",
      checkoutUrl: null,
      qrPayload: null,
      action: {
        type: "enterprise_contract",
        confirmableBy: "admin",
        channel: "enterprise_contract",
      },
    };
  }

  async verifyWebhook(
    _rawBody: Uint8Array,
    _headers: Record<string, string>,
    _config: ProviderConfig,
  ): Promise<VerifiedWebhook> {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "Contract payments have no public webhook; admin confirmation is required",
    );
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    return {
      providerRef,
      status: "pending",
      amountCents: 0,
      currency: "USD",
      merchantId: config.merchantId,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      providerRef: `contract_rf_${input.idempotencyKey}`,
      status: "succeeded",
      amountCents: input.amountCents,
    };
  }

  async healthCheck(_config: ProviderConfig): Promise<HealthStatus> {
    return { ok: true, issues: [], capabilities: defaultCapabilities("contract") };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return {
      provider: this.provider,
      providerRef: `contract_${input.orderId}`,
      status: "requires_action",
      raw: { channel: "enterprise_contract" },
    };
  }

  async handleCallback(input: PaymentCallbackInput): Promise<PaymentCallbackResult> {
    return {
      orderId: String(input.payload.orderId ?? ""),
      providerRef: String(input.payload.providerRef ?? ""),
      status: "paid",
      raw: input.payload,
    };
  }
}

export class UnimplementedPaymentAdapter implements PaymentAdapter {
  constructor(readonly provider: ProviderId) {}

  async createCheckout(_input: CreateCheckoutInput): Promise<CheckoutSession> {
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      `${this.provider} live adapter is not installed; store credentials via admin and wait for the adapter package`,
    );
  }

  async verifyWebhook(
    _rawBody: Uint8Array,
    _headers: Record<string, string>,
    _config: ProviderConfig,
  ): Promise<VerifiedWebhook> {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      `${this.provider} live adapter is not installed`,
    );
  }

  async queryPayment(_providerRef: string, _config: ProviderConfig): Promise<PaymentQueryResult> {
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      `${this.provider} live adapter is not installed`,
    );
  }

  async refund(_input: RefundInput, _config: ProviderConfig): Promise<RefundResult> {
    throw new EntitlementException(
      "PAYMENT_REFUND_UNSUPPORTED",
      `${this.provider} live adapter is not installed`,
    );
  }

  async healthCheck(_config: ProviderConfig): Promise<HealthStatus> {
    return {
      ok: false,
      issues: ["adapter_not_implemented"],
      capabilities: defaultCapabilities(this.provider),
    };
  }
}

export const UNIMPLEMENTED_PROVIDER_IDS: ProviderId[] = [];
