/**
 * Provider-neutral payment adapter contract (spec/payment-platform.md).
 * Alipay, PayPal, WeChat Pay v3, UnionPay/Cloud QuickPass, Stripe Checkout,
 * Coinbase Business Checkout, OKX x402, and BitPay are registered adapters.
 * Keep credential crypto in PaymentConfigService.
 */

import type { ProviderCapabilities, ProviderId } from "../../common/payment-providers";

export interface ProviderConfig {
  id: string;
  providerId: ProviderId;
  environment: "sandbox" | "live";
  enabled: boolean;
  status: "active" | "disabled" | "retiring";
  marketScopes: string[];
  currencies: string[];
  priority: number;
  capabilities: ProviderCapabilities;
  merchantId: string | null;
  /** Decrypted in-memory only. Never log, audit, or return from GET. */
  credentials: Record<string, string>;
  metadata: Record<string, unknown>;
}

export interface CreateCheckoutInput {
  orderId: string;
  attemptId: string;
  amountCents: number;
  currency: string;
  returnUrl?: string | null;
  metadata?: Record<string, unknown>;
  config: ProviderConfig;
}

export interface CheckoutSession {
  provider: string;
  providerRef: string;
  status: "pending" | "requires_action" | "succeeded" | "failed";
  checkoutUrl?: string | null;
  qrPayload?: string | null;
  action?: Record<string, unknown> | null;
}

export interface VerifiedWebhook {
  eventId: string;
  orderId: string;
  attemptId?: string | null;
  providerRef: string;
  status: "succeeded" | "failed" | "pending" | "ignored";
  amountCents: number;
  currency: string;
  merchantId?: string | null;
  requiresQuery?: boolean;
  payload: Record<string, unknown>;
  ack?: { status: number; body: unknown; contentType?: string };
}

export interface CompleteCheckoutInput {
  orderId: string;
  attemptId: string;
  providerRef: string;
  amountCents: number;
  currency: string;
  config: ProviderConfig;
  /** Stored checkout action/challenge (e.g. OKX x402 paymentRequired). */
  action?: Record<string, unknown> | null;
  /** Buyer PAYMENT-SIGNATURE / payload for x402 proof completion. */
  buyerProof?: {
    paymentSignature?: string | null;
    paymentPayload?: Record<string, unknown> | null;
  } | null;
}

export interface HealthCheckOptions {
  /** Remote token/gateway probes. Admin test only — never on list/checkout routes. */
  remote?: boolean;
}

export interface PaymentQueryResult {
  providerRef: string;
  orderId?: string | null;
  attemptId?: string | null;
  status: "pending" | "succeeded" | "failed" | "canceled" | "expired";
  amountCents: number;
  currency: string;
  merchantId?: string | null;
  settlementProof?: Record<string, unknown> | null;
}

export interface RefundInput {
  orderId: string;
  attemptId: string;
  providerRef: string;
  amountCents: number;
  currency: string;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRef: string;
  status: "pending" | "succeeded" | "failed";
  amountCents: number;
}

export interface HealthStatus {
  ok: boolean;
  issues: string[];
  capabilities: ProviderCapabilities;
  diagnostics?: Record<string, unknown>;
}

/** @deprecated Compatibility for existing mock tests / admin tooling. */
export interface CreatePaymentInput {
  orderId: string;
  amountCents: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

/** @deprecated Compatibility for existing mock tests / admin tooling. */
export interface CreatePaymentResult {
  provider: string;
  providerRef: string;
  status: "requires_action" | "authorized" | "captured" | "failed";
  raw?: Record<string, unknown>;
}

/** @deprecated Dev/manual admin callback only — not a live user webhook. */
export interface PaymentCallbackInput {
  provider: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** @deprecated Dev/manual admin callback only — not a live user webhook. */
export interface PaymentCallbackResult {
  orderId: string;
  providerRef: string;
  status: "paid" | "failed" | "ignored";
  raw?: Record<string, unknown>;
}

export interface PaymentAdapter {
  readonly provider: ProviderId | string;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  verifyWebhook(
    rawBody: Uint8Array,
    headers: Record<string, string>,
    config: ProviderConfig,
  ): Promise<VerifiedWebhook>;
  queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult>;
  refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult>;
  healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus>;
  /**
   * Authenticated capture / confirm after the buyer returns. Must use server
   * snapshot amounts and provider APIs — never browser-provided amount/status.
   */
  completeCheckout?(input: CompleteCheckoutInput): Promise<PaymentQueryResult>;
  /** @deprecated Prefer createCheckout. Kept so mock tests can keep calling pay(). */
  createPayment?(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** @deprecated Admin/dev only. Live fulfillment must use verifyWebhook. */
  handleCallback?(input: PaymentCallbackInput): Promise<PaymentCallbackResult>;
}

export const PAYMENT_ADAPTERS = Symbol("PAYMENT_ADAPTERS");
