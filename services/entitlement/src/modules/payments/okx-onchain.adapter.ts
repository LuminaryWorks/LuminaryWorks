import { Inject, Injectable, Optional } from "@nestjs/common";
import { EntitlementException } from "../../common/errors";
import {
  assertOkxOnchainCredentials,
  okxCompleteResourceUrl,
  resolveOkxResourceBaseUrl,
} from "../../common/payment-credentials";
import { redactPaymentSecrets } from "../../common/payment-crypto";
import { defaultCapabilities } from "../../common/payment-providers";
import {
  defaultOkxX402Factory,
  officialOkxSdkAvailable,
  type OkxX402Factory,
} from "./okx-x402-sdk";
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
import { OKX_X402_FACTORY } from "./payment-runtime";

@Injectable()
export class OkxOnchainPaymentAdapter implements PaymentAdapter {
  readonly provider = "okx_onchain" as const;

  constructor(@Optional() @Inject(OKX_X402_FACTORY) private readonly factory?: OkxX402Factory) {}

  private factoryFn(): OkxX402Factory {
    return this.factory ?? defaultOkxX402Factory();
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const creds = assertOkxOnchainCredentials(input.config.credentials);
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "OKX x402 amount must be a positive integer minor unit",
      );
    }
    const resourceBaseUrl = resolveOkxResourceBaseUrl(creds, input.config.metadata);
    const resourceUrl = okxCompleteResourceUrl(resourceBaseUrl, input.orderId);
    const session = await this.factoryFn()(creds);
    const paymentRequired = await session.createPaymentRequired({
      amountCents: input.amountCents,
      currency: input.currency,
      orderId: input.orderId,
      attemptId: input.attemptId,
      resourceUrl,
    });
    const persistedUrl =
      paymentRequired.resource && typeof paymentRequired.resource.url === "string"
        ? paymentRequired.resource.url
        : resourceUrl;
    if (persistedUrl !== resourceUrl) {
      paymentRequired.resource = { ...paymentRequired.resource, url: resourceUrl };
    }
    return {
      provider: this.provider,
      providerRef: `x402:${input.attemptId}`,
      status: "requires_action",
      checkoutUrl: null,
      qrPayload: null,
      action: {
        type: "x402",
        scheme: "exact",
        callback: "POST /v1/orders/:id/complete",
        resourceUrl,
        paymentRequired,
        orderId: input.orderId,
        attemptId: input.attemptId,
      },
    };
  }

  async completeCheckout(input: CompleteCheckoutInput): Promise<PaymentQueryResult> {
    const creds = assertOkxOnchainCredentials(input.config.credentials);
    const session = await this.factoryFn()(creds);
    // Resume path: prior settle already returned a tx hash — poll instead of re-signing.
    if (
      typeof input.providerRef === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(input.providerRef) &&
      !input.buyerProof?.paymentSignature &&
      !input.buyerProof?.paymentPayload
    ) {
      const queried = await session.querySettlement(input.providerRef);
      const succeeded = queried.success === true && queried.status !== "failed" && queried.status !== "pending";
      return {
        providerRef: queried.transaction || input.providerRef,
        orderId: input.orderId,
        attemptId: input.attemptId,
        status: succeeded ? "succeeded" : "pending",
        amountCents: input.amountCents,
        currency: input.currency,
        merchantId: input.config.merchantId || creds.payTo,
        settlementProof: redactPaymentSecrets({ ...queried }),
      };
    }
    const payload = this.decodeBuyerProof(session, input);
    const requirements = this.storedRequirements(input.action);
    // Official facilitator requires paymentPayload.accepted; pin it to the
    // server-stored challenge so a buyer cannot swap terms in the header.
    payload.accepted = requirements;
    const verified = await session.verifyPayment(payload, requirements);
    if (!verified.isValid) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        verified.invalidReason || "OKX x402 verifyPayment rejected the payload",
      );
    }
    const settled = await session.settlePayment(payload, requirements);
    const tx = typeof settled.transaction === "string" ? settled.transaction : "";
    let statusRaw = settled.status ?? (settled.success ? "success" : "failed");
    // Facilitator often returns success+pending while the chain confirms; poll briefly.
    if (settled.success === true && tx && statusRaw === "pending") {
      for (let i = 0; i < 8; i++) {
        const queried = await session.querySettlement(tx);
        statusRaw = queried.status ?? statusRaw;
        if (queried.success === true && queried.status !== "pending" && queried.status !== "failed") {
          return {
            providerRef: queried.transaction || tx,
            orderId: input.orderId,
            attemptId: input.attemptId,
            status: "succeeded",
            amountCents: input.amountCents,
            currency: input.currency,
            merchantId: input.config.merchantId || creds.payTo,
            settlementProof: redactPaymentSecrets({
              transaction: queried.transaction || tx,
              network: settled.network,
              payer: settled.payer,
              status: queried.status ?? "success",
            }),
          };
        }
        if (queried.status === "failed") {
          statusRaw = "failed";
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    const success =
      settled.success === true && statusRaw !== "timeout" && statusRaw !== "failed";
    if (!success || statusRaw === "pending") {
      return {
        providerRef: tx || input.providerRef,
        orderId: input.orderId,
        attemptId: input.attemptId,
        status: "pending",
        amountCents: input.amountCents,
        currency: input.currency,
        merchantId: input.config.merchantId || creds.payTo,
        settlementProof: redactPaymentSecrets({ ...settled, status: statusRaw }),
      };
    }
    return {
      providerRef: tx || input.providerRef,
      orderId: input.orderId,
      attemptId: input.attemptId,
      status: "succeeded",
      amountCents: input.amountCents,
      currency: input.currency,
      merchantId: input.config.merchantId || creds.payTo,
      settlementProof: redactPaymentSecrets({
        transaction: tx || settled.transaction,
        network: settled.network,
        payer: settled.payer,
        status: statusRaw || "success",
      }),
    };
  }

  async verifyWebhook(
    _rawBody: Uint8Array,
    _headers: Record<string, string>,
    _config: ProviderConfig,
  ): Promise<VerifiedWebhook> {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "okx_onchain has no public webhook; complete payment with POST /v1/orders/:id/complete and PAYMENT-SIGNATURE",
    );
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const creds = assertOkxOnchainCredentials(config.credentials);
    if (providerRef.startsWith("x402:")) {
      return {
        providerRef,
        status: "pending",
        amountCents: 0,
        currency: config.currencies[0] ?? "USD",
        merchantId: config.merchantId || creds.payTo,
      };
    }
    const session = await this.factoryFn()(creds);
    const queried = await session.querySettlement(providerRef);
    const succeeded = queried.success === true && queried.status !== "failed";
    return {
      providerRef: queried.transaction || providerRef,
      status: succeeded && queried.status !== "pending" ? "succeeded" : "pending",
      amountCents: 0,
      currency: config.currencies[0] ?? "USD",
      merchantId: config.merchantId || creds.payTo,
      settlementProof: redactPaymentSecrets({ ...queried }),
    };
  }

  async refund(_input: RefundInput, _config: ProviderConfig): Promise<RefundResult> {
    throw new EntitlementException(
      "PAYMENT_REFUND_UNSUPPORTED",
      "OKX Onchain OS x402 has no official refund API in the installed SDK",
    );
  }

  async healthCheck(config: ProviderConfig, _opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const sdk = officialOkxSdkAvailable();
    const diagnostics: Record<string, unknown> = {
      officialSdk: sdk.ok,
      officialFastifyPackage: sdk.officialFastifyPackage,
      webhook: false,
      hostedUrl: false,
      refund: false,
      callback: "POST /v1/orders/:id/complete",
    };
    if (!sdk.ok) issues.push("official_sdk_unavailable");
    try {
      const creds = assertOkxOnchainCredentials(config.credentials);
      const resourceBaseUrl = resolveOkxResourceBaseUrl(creds, config.metadata);
      diagnostics.network = creds.network;
      diagnostics.payToLastFour = creds.payTo.slice(-4);
      diagnostics.resourceBaseUrl = resourceBaseUrl;
      diagnostics.completePath = "/v1/orders/:id/complete";
    } catch (err) {
      issues.push(err instanceof Error ? err.message : "credential_invalid");
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("okx_onchain"),
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private decodeBuyerProof(
    session: Awaited<ReturnType<OkxX402Factory>>,
    input: CompleteCheckoutInput,
  ): Record<string, unknown> {
    const signature = input.buyerProof?.paymentSignature?.trim() ?? "";
    if (signature) {
      try {
        return this.buyerPayloadWithoutRequirements(session.decodePaymentSignature(signature));
      } catch {
        throw new EntitlementException(
          "PAYMENT_WEBHOOK_INVALID",
          "OKX PAYMENT-SIGNATURE could not be decoded by the official SDK",
        );
      }
    }
    const payload = input.buyerProof?.paymentPayload;
    if (payload && typeof payload === "object") {
      return this.buyerPayloadWithoutRequirements(payload);
    }
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "OKX x402 completion requires paymentSignature or paymentPayload",
    );
  }

  private buyerPayloadWithoutRequirements(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const sanitized = { ...payload };
    // Drop alternate challenge shapes; `accepted` is overwritten from storage
    // in completeCheckout before verify/settle.
    delete sanitized.paymentRequired;
    delete sanitized.accepts;
    return sanitized;
  }

  private storedRequirements(
    action: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    const paymentRequired =
      action?.paymentRequired && typeof action.paymentRequired === "object"
        ? (action.paymentRequired as Record<string, unknown>)
        : null;
    const accepts = paymentRequired?.accepts;
    if (!Array.isArray(accepts) || !accepts[0] || typeof accepts[0] !== "object") {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "OKX x402 checkout challenge is missing stored payment requirements",
      );
    }
    return accepts[0] as Record<string, unknown>;
  }
}
