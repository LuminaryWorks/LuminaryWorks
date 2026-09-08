import {
  assertOkxOnchainCredentials,
  okxCompleteResourceUrl,
  resolveOkxResourceBaseUrl,
} from "../src/common/payment-credentials";
import { EntitlementException } from "../src/common/errors";
import { defaultCapabilities } from "../src/common/payment-providers";
import { OkxOnchainPaymentAdapter } from "../src/modules/payments/okx-onchain.adapter";
import type { OkxX402Factory } from "../src/modules/payments/okx-x402-sdk";
import { okxConfig } from "./payment-adapter-fixtures";

const storedAccept = {
  scheme: "exact",
  network: "eip155:196",
  amount: "12000000",
  asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 300,
  extra: {},
};

function paymentRequired(resourceUrl: string) {
  return {
    x402Version: 2,
    resource: { url: resourceUrl },
    accepts: [storedAccept],
  };
}

function factory(
  opts: {
    verifyValid?: boolean;
    settleSuccess?: boolean;
    settleStatus?: string;
    transaction?: string;
    seen?: { resourceUrl?: string; requirements?: Record<string, unknown> };
  } = {},
): OkxX402Factory {
  return async () => ({
    async createPaymentRequired(input) {
      if (opts.seen) opts.seen.resourceUrl = input.resourceUrl;
      return paymentRequired(input.resourceUrl);
    },
    decodePaymentSignature(header: string) {
      if (header === "bad") throw new Error("decode failed");
      return {
        x402Version: 2,
        payload: { sig: header },
        accepted: { ...storedAccept, amount: "1", payTo: "0xdead" },
      };
    },
    async verifyPayment(_payload, requirements) {
      if (opts.seen) opts.seen.requirements = requirements;
      return { isValid: opts.verifyValid !== false, invalidReason: "bad_sig" };
    },
    async settlePayment(_payload, requirements) {
      if (opts.seen) opts.seen.requirements = requirements;
      return {
        success: opts.settleSuccess !== false,
        status: opts.settleStatus ?? "success",
        transaction: opts.transaction ?? "0xabc",
        network: "eip155:196",
      };
    },
    async querySettlement(txHash: string) {
      return { success: true, status: "success", transaction: txHash };
    },
  });
}

describe("okx_onchain adapter", () => {
  const config = okxConfig();
  const completeUrl = "https://entitlement.example.com/v1/orders/ord_1/complete";

  it("returns an x402 action with a public complete URL and no hosted checkout", async () => {
    const seen: { resourceUrl?: string } = {};
    const adapter = new OkxOnchainPaymentAdapter(factory({ seen }));
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      config,
    });
    expect(session.checkoutUrl).toBeNull();
    expect(seen.resourceUrl).toBe(completeUrl);
    expect(session.action).toMatchObject({
      type: "x402",
      callback: "POST /v1/orders/:id/complete",
      resourceUrl: completeUrl,
    });
    expect(
      (session.action?.paymentRequired as { resource?: { url?: string } })?.resource?.url,
    ).toBe(completeUrl);
    expect(defaultCapabilities("okx_onchain").hostedUrl).toBe(false);
    expect(defaultCapabilities("okx_onchain").webhook).toBe(false);
  });

  it("builds the complete URL from metadata when credentials omit resourceBaseUrl", async () => {
    const seen: { resourceUrl?: string } = {};
    const adapter = new OkxOnchainPaymentAdapter(factory({ seen }));
    const { resourceBaseUrl: _omit, ...credentials } = config.credentials;
    await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      config: {
        ...config,
        credentials,
        metadata: { entitlementPublicBaseUrl: "https://pay.example.com/" },
      },
    });
    expect(seen.resourceUrl).toBe("https://pay.example.com/v1/orders/ord_1/complete");
  });

  it("fails closed without a public resource base URL and rejects private hosts", async () => {
    const adapter = new OkxOnchainPaymentAdapter(factory({}));
    const { resourceBaseUrl: _omit, ...credentials } = config.credentials;
    await expect(
      adapter.createCheckout({
        orderId: "ord_1",
        attemptId: "att_1",
        amountCents: 1200,
        currency: "USD",
        config: { ...config, credentials, metadata: {} },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(() =>
      resolveOkxResourceBaseUrl(assertOkxOnchainCredentials(credentials), {
        resourceBaseUrl: "https://127.0.0.1",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      resolveOkxResourceBaseUrl(assertOkxOnchainCredentials(credentials), {
        resourceBaseUrl: "https://192.168.1.20/entitlement",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      resolveOkxResourceBaseUrl(assertOkxOnchainCredentials(credentials), {
        resourceBaseUrl: "https://10.0.0.8",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      resolveOkxResourceBaseUrl(assertOkxOnchainCredentials(credentials), {
        resourceBaseUrl: "http://entitlement.example.com",
      }),
    ).toThrow(EntitlementException);
    expect(okxCompleteResourceUrl("https://entitlement.example.com", "ord_1")).toBe(completeUrl);
  });

  it("fulfills only after official verifyPayment and settlePayment succeed", async () => {
    const adapter = new OkxOnchainPaymentAdapter(factory({}));
    const created = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      config,
    });
    const result = await adapter.completeCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      providerRef: created.providerRef,
      amountCents: 1200,
      currency: "USD",
      config,
      action: created.action,
      buyerProof: { paymentSignature: "c2ln" },
    });
    expect(result.status).toBe("succeeded");
    expect(result.providerRef).toBe("0xabc");
    expect(result.settlementProof).toMatchObject({ transaction: "0xabc" });
  });

  it("uses stored checkout requirements and ignores browser-replaced accepted terms", async () => {
    const seen: { requirements?: Record<string, unknown> } = {};
    const adapter = new OkxOnchainPaymentAdapter(factory({ seen }));
    const created = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      config,
    });
    const replaced = {
      scheme: "exact",
      network: "eip155:196",
      amount: "1",
      asset: "0x0000000000000000000000000000000000000001",
      payTo: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
    };
    await adapter.completeCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      providerRef: created.providerRef,
      amountCents: 1200,
      currency: "USD",
      config,
      action: created.action,
      buyerProof: {
        paymentPayload: {
          x402Version: 2,
          accepted: replaced,
          paymentRequired: { accepts: [replaced] },
          payload: { authorization: "buyer" },
        },
      },
    });
    expect(seen.requirements).toEqual(storedAccept);
    expect(seen.requirements).not.toMatchObject({ amount: "1" });
  });

  it("does not fulfill when official verifyPayment fails", async () => {
    const adapter = new OkxOnchainPaymentAdapter(factory({ verifyValid: false }));
    const created = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      config,
    });
    await expect(
      adapter.completeCheckout({
        orderId: "ord_1",
        attemptId: "att_1",
        providerRef: created.providerRef,
        amountCents: 1200,
        currency: "USD",
        config,
        action: created.action,
        buyerProof: { paymentSignature: "c2ln" },
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
  });

  it("does not fulfill when settlePayment is unsuccessful", async () => {
    const adapter = new OkxOnchainPaymentAdapter(
      factory({ settleSuccess: false, settleStatus: "failed", transaction: "0xdead" }),
    );
    const created = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      config,
    });
    const result = await adapter.completeCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      providerRef: created.providerRef,
      amountCents: 1200,
      currency: "USD",
      config,
      action: created.action,
      buyerProof: { paymentPayload: { x402Version: 2 } },
    });
    expect(result.status).toBe("pending");
  });

  it("rejects public webhooks and refunds, and fails closed without the official SDK factory", async () => {
    const adapter = new OkxOnchainPaymentAdapter(factory({}));
    await expect(adapter.verifyWebhook(Buffer.from("{}"), {}, config)).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });
    await expect(
      adapter.refund(
        {
          orderId: "ord_1",
          attemptId: "att_1",
          providerRef: "0xabc",
          amountCents: 1200,
          currency: "USD",
          idempotencyKey: "rf",
        },
        config,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_REFUND_UNSUPPORTED" });

    const closed = new OkxOnchainPaymentAdapter(async () => {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Official @okxweb3/x402-core / @okxweb3/x402-evm SDK is not available",
      );
    });
    await expect(
      closed.createCheckout({
        orderId: "ord_1",
        attemptId: "att_1",
        amountCents: 1200,
        currency: "USD",
        config,
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_UNAVAILABLE" });

    const bare = await new OkxOnchainPaymentAdapter(factory({})).healthCheck({
      ...config,
      credentials: credentialsWithoutResource(config.credentials),
      metadata: {},
    });
    expect(bare.ok).toBe(false);
  });
});

function credentialsWithoutResource(credentials: Record<string, string>): Record<string, string> {
  const { resourceBaseUrl: _omit, ...rest } = credentials;
  return rest;
}
