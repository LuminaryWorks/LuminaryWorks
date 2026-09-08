import { hmacSha256Base64 } from "../src/common/crypto";
import { defaultCapabilities } from "../src/common/payment-providers";
import { BitpayPaymentAdapter } from "../src/modules/payments/bitpay.adapter";
import type { BitpayMerchantFactory } from "../src/modules/payments/bitpay-sdk";
import { bitpayConfig, jsonResponse } from "./payment-adapter-fixtures";

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "Hpqc63wvE1ZjzeeH4kEycF",
      url: "https://test.bitpay.com/invoice?id=Hpqc63wvE1ZjzeeH4kEycF",
      status: "new",
      price: 12,
      currency: "USD",
      orderId: "ord_1",
      posData: JSON.stringify({ orderId: "ord_1", attemptId: "att_1" }),
      token: "invoice-token",
      ...overrides,
    },
  };
}

function readUrl(url: string): URL {
  return new URL(String(url));
}

const SIGNING_PRIVATE_KEY = "11".repeat(32);

describe("bitpay adapter", () => {
  const config = bitpayConfig();

  it("creates an official invoice URL with POS token metadata", async () => {
    const adapter = new BitpayPaymentAdapter(async (url, init) => {
      expect(readUrl(String(url)).hostname).toBe("test.bitpay.com");
      const body = JSON.parse(String(init?.body));
      expect(body.token).toBe(config.credentials.posToken);
      expect(body.orderId).toBe("ord_1");
      expect(body.notificationURL).toMatch(/^https:/);
      return jsonResponse(invoice());
    });
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      returnUrl: "https://app.example.com/billing/return",
      config,
    });
    expect(session.checkoutUrl).toContain("test.bitpay.com");
    expect(defaultCapabilities("bitpay").requiresQueryBeforeFulfill).toBe(true);
  });

  it("treats unsigned IPN as a query trigger and waits until complete", async () => {
    const body = JSON.stringify({
      event: { code: 1005, name: "invoice_completed" },
      data: { id: "Hpqc63wvE1ZjzeeH4kEycF", status: "complete", orderId: "ord_1" },
    });
    const adapter = new BitpayPaymentAdapter(async () =>
      jsonResponse(invoice({ status: "complete" })),
    );
    const verified = await adapter.verifyWebhook(Buffer.from(body), {}, config);
    expect(verified.requiresQuery).toBe(true);
    expect(verified.status).toBe("pending");
    expect(verified.ack?.body).toBe("Success");
    const query = await adapter.queryPayment("Hpqc63wvE1ZjzeeH4kEycF", config);
    expect(query.status).toBe("succeeded");
    expect(query.amountCents).toBe(1200);
  });

  it("keeps paid and confirmed invoices pending", async () => {
    const adapter = new BitpayPaymentAdapter(async () => jsonResponse(invoice({ status: "paid" })));
    expect((await adapter.queryPayment("Hpqc63wvE1ZjzeeH4kEycF", config)).status).toBe("pending");
    const confirmed = new BitpayPaymentAdapter(async () =>
      jsonResponse(invoice({ status: "confirmed" })),
    );
    expect((await confirmed.queryPayment("Hpqc63wvE1ZjzeeH4kEycF", config)).status).toBe("pending");
  });

  it("verifies x-signature HMAC on raw body and JSON.parse+stringify candidates", async () => {
    const hmacConfig = bitpayConfig({
      credentials: { ...config.credentials, ipnHmacSecret: "hmac-secret-value" },
    });
    const adapter = new BitpayPaymentAdapter();
    await expect(adapter.verifyWebhook(Buffer.from("{}"), {}, hmacConfig)).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });

    const rawObject = { data: { id: "inv1", status: "paid", note: "hello world" } };
    const compact = JSON.stringify(rawObject);
    const pretty = `{\n  "data": {\n    "id": "inv1",\n    "status": "paid",\n    "note": "hello world"\n  }\n}`;
    expect(pretty.replace(/\s+/g, "")).toContain("helloworld");
    expect(JSON.stringify(JSON.parse(pretty))).toBe(compact);
    expect(JSON.stringify(JSON.parse(pretty))).toContain("hello world");

    const rawSig = hmacSha256Base64("hmac-secret-value", compact);
    expect(
      (await adapter.verifyWebhook(Buffer.from(compact), { "x-signature": rawSig }, hmacConfig))
        .requiresQuery,
    ).toBe(true);

    const canonicalSig = hmacSha256Base64("hmac-secret-value", JSON.stringify(JSON.parse(pretty)));
    expect(
      (
        await adapter.verifyWebhook(
          Buffer.from(pretty),
          { "x-signature": canonicalSig },
          hmacConfig,
        )
      ).requiresQuery,
    ).toBe(true);

    const strippedSig = hmacSha256Base64("hmac-secret-value", pretty.replace(/\s+/g, ""));
    await expect(
      adapter.verifyWebhook(Buffer.from(pretty), { "x-signature": strippedSig }, hmacConfig),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
  });

  it("rejects wrong amount/currency on query and does not treat merchant token as refund-ready", async () => {
    const adapter = new BitpayPaymentAdapter(async () =>
      jsonResponse(invoice({ status: "complete", price: 50, currency: "EUR" })),
    );
    const query = await adapter.queryPayment("Hpqc63wvE1ZjzeeH4kEycF", config);
    expect(query.amountCents).toBe(5000);
    expect(query.currency).toBe("EUR");
    const tokenOnly = bitpayConfig({
      credentials: { ...config.credentials, merchantToken: "B".repeat(44) },
    });
    await expect(
      adapter.refund(
        {
          orderId: "ord_1",
          attemptId: "att_1",
          providerRef: "Hpqc63wvE1ZjzeeH4kEycF",
          amountCents: 1200,
          currency: "USD",
          idempotencyKey: "rf",
        },
        tokenOnly,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_REFUND_UNSUPPORTED" });
    const health = await adapter.healthCheck(tokenOnly);
    expect(health.capabilities.refund).toBe(false);
    expect(defaultCapabilities("bitpay").refund).toBe(false);
  });

  it("refunds through the official signed SDK wrapper when privateKey and merchantToken are set", async () => {
    const signingConfig = bitpayConfig({
      credentials: {
        ...config.credentials,
        merchantToken: "B".repeat(44),
        privateKey: SIGNING_PRIVATE_KEY,
      },
    });
    const seen: { invoiceId?: string; token?: string; privateKey?: string } = {};
    const factory: BitpayMerchantFactory = async (input) => {
      seen.privateKey = input.privateKey;
      seen.token = input.merchantToken;
      return {
        async createRefund(refund) {
          seen.invoiceId = refund.invoiceId;
          return { id: "rf_1", status: "created", amount: 12 };
        },
      };
    };
    const adapter = new BitpayPaymentAdapter(
      async () => {
        throw new Error("unsigned merchant HTTP must not run");
      },
      undefined,
      factory,
    );
    const refund = await adapter.refund(
      {
        orderId: "ord_1",
        attemptId: "att_1",
        providerRef: "Hpqc63wvE1ZjzeeH4kEycF",
        amountCents: 1200,
        currency: "USD",
        idempotencyKey: "rf-1",
      },
      signingConfig,
    );
    expect(refund.status).toBe("pending");
    expect(refund.providerRef).toBe("rf_1");
    expect(seen.privateKey).toBe(SIGNING_PRIVATE_KEY);
    expect(seen.token).toBe("B".repeat(44));
    expect(seen.invoiceId).toBe("Hpqc63wvE1ZjzeeH4kEycF");
    const health = await adapter.healthCheck(signingConfig);
    expect(health.capabilities.refund).toBe(true);
    expect(health.diagnostics?.refundSigning).toBe("bitpay-sdk");
  });
});
