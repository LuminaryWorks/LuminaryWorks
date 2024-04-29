import { Injectable } from "@nestjs/common";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentAdapter,
  PaymentCallbackInput,
  PaymentCallbackResult,
} from "./payment-adapter";

@Injectable()
export class MockPaymentAdapter implements PaymentAdapter {
  readonly provider = "mock";

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return {
      provider: this.provider,
      providerRef: `mock_${input.orderId}`,
      status: "authorized",
      raw: { simulated: true },
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

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return {
      provider: this.provider,
      providerRef: `contract_${input.orderId}`,
      status: "captured",
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
