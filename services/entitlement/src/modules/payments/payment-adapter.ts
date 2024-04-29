/**
 * Provider-neutral payment adapter contracts.
 * Concrete Stripe / WeChat / Alipay adapters are out of scope for todo 2.
 */

export interface CreatePaymentInput {
  orderId: string;
  amountCents: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePaymentResult {
  provider: string;
  providerRef: string;
  status: "requires_action" | "authorized" | "captured" | "failed";
  raw?: Record<string, unknown>;
}

export interface PaymentCallbackInput {
  provider: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface PaymentCallbackResult {
  orderId: string;
  providerRef: string;
  status: "paid" | "failed" | "ignored";
  raw?: Record<string, unknown>;
}

export interface PaymentAdapter {
  readonly provider: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  handleCallback(input: PaymentCallbackInput): Promise<PaymentCallbackResult>;
}

export const PAYMENT_ADAPTERS = Symbol("PAYMENT_ADAPTERS");
