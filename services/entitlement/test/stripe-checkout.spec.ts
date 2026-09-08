import Stripe from "stripe";
import { EntitlementException } from "../src/common/errors";
import { StripeCheckoutPaymentAdapter } from "../src/modules/payments/stripe-checkout.adapter";
import { jsonResponse, stripeConfig } from "./payment-adapter-fixtures";

const fixedNow = new Date("2026-09-07T12:00:00Z");
const clock = { now: () => fixedNow };

function sessionObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_1",
    object: "checkout.session",
    payment_status: "paid",
    status: "complete",
    amount_total: 1200,
    currency: "usd",
    client_reference_id: "ord_1",
    metadata: { orderId: "ord_1", attemptId: "att_1" },
    payment_intent: "pi_1",
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
    ...overrides,
  };
}

function readBody(body: BodyInit | null | undefined): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return Buffer.from(body).toString("utf8");
  }
  return String(body);
}

function signedEvent(
  type: string,
  object: Record<string, unknown>,
  secret: string,
  timestamp = Math.floor(fixedNow.getTime() / 1000),
) {
  const payload = JSON.stringify({
    id: `evt_${type}`,
    object: "event",
    type,
    api_version: "2026-08-26",
    data: { object },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
  return { body: Buffer.from(payload), headers: { "stripe-signature": header } };
}

describe("stripe_checkout adapter", () => {
  const config = stripeConfig();
  const secret = config.credentials.webhookSecret;

  it("creates a hosted Checkout Session in payment mode with server price", async () => {
    const seen: { url?: string; body?: string } = {};
    const adapter = new StripeCheckoutPaymentAdapter(async (url, init) => {
      seen.url = String(url);
      seen.body = readBody(init?.body);
      return jsonResponse(sessionObject({ payment_status: "unpaid", status: "open" }));
    }, clock);
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      returnUrl: "https://app.example.com/billing/return",
      config,
    });
    const parsed = new URL(seen.url ?? "");
    expect(parsed.hostname).toBe("api.stripe.com");
    expect(parsed.pathname).toBe("/v1/checkout/sessions");
    expect(seen.body).toContain("mode=payment");
    expect(seen.body).toContain("client_reference_id=ord_1");
    expect(seen.body).toContain("[unit_amount]=1200");
    expect(session.status).toBe("pending");
    expect(session.checkoutUrl).toContain("checkout.stripe.com");
  });

  it("fulfills only checkout.session.completed with payment_status=paid", async () => {
    const adapter = new StripeCheckoutPaymentAdapter(undefined, clock);
    const paid = signedEvent("checkout.session.completed", sessionObject(), secret);
    const verified = await adapter.verifyWebhook(paid.body, paid.headers, config);
    expect(verified.status).toBe("succeeded");
    const unpaid = signedEvent(
      "checkout.session.completed",
      sessionObject({ payment_status: "unpaid" }),
      secret,
    );
    const pending = await adapter.verifyWebhook(unpaid.body, unpaid.headers, config);
    expect(pending.status).toBe("pending");
    expect(pending.requiresQuery).toBe(true);
  });

  it("rejects a bad or stale Stripe-Signature", async () => {
    const adapter = new StripeCheckoutPaymentAdapter(undefined, clock);
    const paid = signedEvent("checkout.session.completed", sessionObject(), secret);
    await expect(
      adapter.verifyWebhook(paid.body, { "stripe-signature": "t=1,v1=deadbeef" }, config),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
    const stale = signedEvent(
      "checkout.session.completed",
      sessionObject(),
      secret,
      Math.floor(fixedNow.getTime() / 1000) - 4000,
    );
    await expect(adapter.verifyWebhook(stale.body, stale.headers, config)).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });
  });

  it("queries session/PaymentIntent and supports partial refunds", async () => {
    const adapter = new StripeCheckoutPaymentAdapter(async (url, init) => {
      const parsed = new URL(String(url));
      expect(parsed.hostname).toBe("api.stripe.com");
      if (parsed.pathname === "/v1/refunds") {
        expect(readBody(init?.body)).toContain("amount=400");
        return jsonResponse({ id: "re_1", object: "refund", status: "succeeded", amount: 400 });
      }
      if (parsed.pathname.startsWith("/v1/payment_intents/")) {
        return jsonResponse({
          id: "pi_1",
          object: "payment_intent",
          status: "succeeded",
          amount: 1200,
          amount_received: 1200,
          currency: "usd",
          metadata: { orderId: "ord_1", attemptId: "att_1" },
        });
      }
      return jsonResponse(sessionObject());
    }, clock);
    const query = await adapter.queryPayment("cs_test_1", config);
    expect(query.status).toBe("succeeded");
    const intent = await adapter.queryPayment("pi_1", config);
    expect(intent.status).toBe("succeeded");
    const refund = await adapter.refund(
      {
        orderId: "ord_1",
        attemptId: "att_1",
        providerRef: "cs_test_1",
        amountCents: 400,
        currency: "USD",
        idempotencyKey: "rf_1",
      },
      config,
    );
    expect(refund.status).toBe("succeeded");
    expect(refund.amountCents).toBe(400);
  });

  it("does not mark paid from a redirect while the session is unpaid", async () => {
    const adapter = new StripeCheckoutPaymentAdapter(async () => {
      return jsonResponse(sessionObject({ payment_status: "unpaid", status: "open" }));
    }, clock);
    const result = await adapter.completeCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      providerRef: "cs_test_1",
      amountCents: 1200,
      currency: "USD",
      config,
    });
    expect(result.status).toBe("pending");
  });

  it("health-checks credential mode locally and retrieves the account only on remote admin test", async () => {
    let remote = 0;
    const adapter = new StripeCheckoutPaymentAdapter(async (url) => {
      remote += 1;
      expect(String(url)).toContain("/v1/account");
      return jsonResponse({ id: "acct_test", object: "account" });
    }, clock);
    const local = await adapter.healthCheck(config);
    expect(local.ok).toBe(true);
    expect(remote).toBe(0);
    expect(JSON.stringify(local)).not.toContain(config.credentials.secretKey);
    const remoteHealth = await adapter.healthCheck(config, { remote: true });
    expect(remoteHealth.ok).toBe(true);
    expect(remoteHealth.diagnostics?.remoteTested).toBe(true);
    const mismatched = await adapter.healthCheck({
      ...config,
      environment: "live",
    });
    expect(mismatched.ok).toBe(false);
  });

  it("times out official HTTPS calls", async () => {
    const adapter = new StripeCheckoutPaymentAdapter(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }, clock);
    await expect(
      adapter.createCheckout({
        orderId: "ord_1",
        attemptId: "att_1",
        amountCents: 1200,
        currency: "USD",
        returnUrl: "https://app.example.com/billing/return",
        config,
      }),
    ).rejects.toBeInstanceOf(EntitlementException);
  });
});
