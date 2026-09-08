import { hmacSha256Hex } from "../src/common/crypto";
import { EntitlementException } from "../src/common/errors";
import { CoinbaseCommercePaymentAdapter } from "../src/modules/payments/coinbase-commerce.adapter";
import { coinbaseConfig, jsonResponse } from "./payment-adapter-fixtures";

const fixedNow = new Date("2026-09-07T12:00:00Z");
const clock = { now: () => fixedNow };
const jwt = async () => "jwt-test-token";

function checkoutObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "68f7a946db0529ea9b6d3a12",
    url: "https://payments.coinbase.com/payment-links/pl_test",
    amount: "12.00",
    currency: "USDC",
    fiatAmount: "12.00",
    fiatCurrency: "USD",
    network: "base",
    status: "ACTIVE",
    metadata: { orderId: "ord_1", attemptId: "att_1" },
    ...overrides,
  };
}

function signHook0(
  body: string,
  secret: string,
  timestamp = Math.floor(fixedNow.getTime() / 1000),
  extraHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-event-id": "evt_cb_1",
    "x-event-type": "checkout.payment.success",
  },
) {
  const headerNames = "content-type x-event-id x-event-type";
  const values = headerNames
    .split(" ")
    .map((name) => extraHeaders[name] ?? "")
    .join(".");
  const v1 = hmacSha256Hex(secret, `${timestamp}.${headerNames}.${values}.${body}`);
  return {
    body: Buffer.from(body),
    headers: {
      ...extraHeaders,
      "x-hook0-signature": `t=${timestamp},h=${headerNames},v1=${v1}`,
    },
  };
}

function readBody(body: BodyInit | null | undefined): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return String(body);
}

describe("coinbase_commerce adapter", () => {
  const config = coinbaseConfig();

  it("creates a single-use Business Checkout with JWT auth and USDC/Base constraints", async () => {
    const seen: { url?: string; auth?: string; idem?: string; body?: string } = {};
    const adapter = new CoinbaseCommercePaymentAdapter(
      async (url, init) => {
        seen.url = String(url);
        seen.auth = String(init?.headers && (init.headers as Record<string, string>).authorization);
        seen.idem = String(
          init?.headers && (init.headers as Record<string, string>)["X-Idempotency-Key"],
        );
        seen.body = readBody(init?.body ?? null);
        return jsonResponse(checkoutObject());
      },
      clock,
      jwt,
    );
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "11111111-1111-4111-8111-111111111111",
      amountCents: 1200,
      currency: "USDC",
      returnUrl: "https://app.example.com/billing/return",
      config,
    });
    expect(seen.url).toBe("https://business.coinbase.com/sandbox/api/v1/checkouts");
    expect(seen.auth).toBe("Bearer jwt-test-token");
    expect(seen.body).toContain('"currency":"USDC"');
    expect(seen.body).toContain('"orderId":"ord_1"');
    expect(session.checkoutUrl).toContain("payments.coinbase.com");
    expect(session.action).toMatchObject({ type: "redirect", network: "base", currency: "USDC" });
  });

  it("rejects speculative fiat currencies and non-Base networks", async () => {
    const adapter = new CoinbaseCommercePaymentAdapter(
      async () => jsonResponse(checkoutObject()),
      clock,
      jwt,
    );
    for (const currency of ["USD", "EUR", "GBP", "SGD"]) {
      await expect(
        adapter.createCheckout({
          orderId: "ord_1",
          attemptId: "att_1",
          amountCents: 1200,
          currency,
          returnUrl: "https://app.example.com/billing/return",
          config,
        }),
      ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH" });
    }
    const wrongNetwork = new CoinbaseCommercePaymentAdapter(
      async () => jsonResponse(checkoutObject({ network: "ethereum" })),
      clock,
      jwt,
    );
    await expect(
      wrongNetwork.createCheckout({
        orderId: "ord_1",
        attemptId: "att_1",
        amountCents: 1200,
        currency: "USDC",
        returnUrl: "https://app.example.com/billing/return",
        config,
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH" });
  });

  it("maps checkout.payment.success from USDC amount, not fiat conversion fields", async () => {
    const adapter = new CoinbaseCommercePaymentAdapter(undefined, clock, jwt);
    const payload = JSON.stringify(
      checkoutObject({
        eventType: "checkout.payment.success",
        status: "COMPLETED",
        amount: "12.00",
        currency: "USDC",
        fiatAmount: "99.00",
        fiatCurrency: "USD",
      }),
    );
    const signed = signHook0(payload, config.credentials.webhookSecret);
    const verified = await adapter.verifyWebhook(signed.body, signed.headers, config);
    expect(verified.status).toBe("succeeded");
    expect(verified.amountCents).toBe(1200);
    expect(verified.currency).toBe("USDC");

    const stale = signHook0(
      payload,
      config.credentials.webhookSecret,
      Math.floor(fixedNow.getTime() / 1000) - 400,
    );
    await expect(adapter.verifyWebhook(stale.body, stale.headers, config)).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });
    await expect(
      adapter.verifyWebhook(signed.body, { "x-hook0-signature": "t=1,v1=deadbeef" }, config),
    ).rejects.toBeInstanceOf(EntitlementException);
  });

  it("maps failed/expired checkout events and ignores refund webhooks", async () => {
    const adapter = new CoinbaseCommercePaymentAdapter(undefined, clock, jwt);
    const failed = JSON.stringify(
      checkoutObject({ eventType: "checkout.payment.failed", status: "FAILED" }),
    );
    const failedSigned = signHook0(failed, config.credentials.webhookSecret, undefined, {
      "content-type": "application/json",
      "x-event-id": "evt_fail",
      "x-event-type": "checkout.payment.failed",
    });
    expect(
      (await adapter.verifyWebhook(failedSigned.body, failedSigned.headers, config)).status,
    ).toBe("failed");
    const refund = JSON.stringify(
      checkoutObject({ eventType: "checkout.refund.success", status: "REFUNDED" }),
    );
    const refundSigned = signHook0(refund, config.credentials.webhookSecret, undefined, {
      "content-type": "application/json",
      "x-event-id": "evt_rf",
      "x-event-type": "checkout.refund.success",
    });
    expect(
      (await adapter.verifyWebhook(refundSigned.body, refundSigned.headers, config)).status,
    ).toBe("ignored");
  });

  it("queries checkout status and posts asynchronous USDC refunds", async () => {
    const adapter = new CoinbaseCommercePaymentAdapter(
      async (url, init) => {
        if (String(url).includes("/refund")) {
          expect(readBody(init?.body ?? null)).toContain('"currency":"USDC"');
          return jsonResponse({
            refund: {
              id: "68f7a946db0529ea9b6d3a99",
              amount: "12.00",
              currency: "USDC",
              status: "PENDING",
            },
          });
        }
        expect(String(init?.method ?? "GET")).toBe("GET");
        return jsonResponse(checkoutObject({ status: "COMPLETED" }));
      },
      clock,
      jwt,
    );
    const query = await adapter.queryPayment("68f7a946db0529ea9b6d3a12", config);
    expect(query.status).toBe("succeeded");
    expect(query.currency).toBe("USDC");
    const refund = await adapter.refund(
      {
        orderId: "ord_1",
        attemptId: "att_1",
        providerRef: "68f7a946db0529ea9b6d3a12",
        amountCents: 1200,
        currency: "USDC",
        idempotencyKey: "rf-1",
      },
      config,
    );
    expect(refund.status).toBe("pending");
    await expect(
      adapter.refund(
        {
          orderId: "ord_1",
          attemptId: "att_1",
          providerRef: "68f7a946db0529ea9b6d3a12",
          amountCents: 1200,
          currency: "USD",
          idempotencyKey: "rf-2",
        },
        config,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH" });
  });

  it("health-checks CDP JWT helper without remote Coinbase calls by default", async () => {
    const adapter = new CoinbaseCommercePaymentAdapter(
      async () => {
        throw new Error("network should not run");
      },
      clock,
      jwt,
    );
    const health = await adapter.healthCheck(config);
    expect(health.ok).toBe(true);
    expect(health.diagnostics?.jwtIssued).toBe(true);
    expect(health.diagnostics?.currency).toBe("USDC");
    expect(health.diagnostics?.network).toBe("base");
  });
});
