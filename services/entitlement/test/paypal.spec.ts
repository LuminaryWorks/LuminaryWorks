import { PaypalPaymentAdapter } from "../src/modules/payments/paypal.adapter";
import { jsonResponse, paypalConfig } from "./payment-adapter-fixtures";

const clock = { now: () => new Date("2026-09-07T12:00:00Z") };

function paypalHeaders(): Record<string, string> {
  return {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.paypal.com/cert.pem",
    "paypal-transmission-id": "tx-1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-09-07T12:00:00Z",
  };
}

describe("paypal adapter", () => {
  it("caches the OAuth2 token and creates a CAPTURE checkout without marking paid", async () => {
    let tokenCalls = 0;
    const adapter = new PaypalPaymentAdapter(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/oauth2/token") {
        tokenCalls += 1;
        expect(String(init?.body)).toContain("grant_type=client_credentials");
        return jsonResponse({ access_token: "tok_live_fixture", expires_in: 3600 });
      }
      if (path === "/v2/checkout/orders") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(body.intent).toBe("CAPTURE");
        const units = body.purchase_units as Array<Record<string, unknown>>;
        const unit = units[0] as Record<string, unknown> | undefined;
        expect(unit?.custom_id).toBe("ord_1");
        expect(unit?.invoice_id).toBe("att_1");
        const amount = unit?.amount as { value?: string } | undefined;
        expect(amount?.value).toBe("12.00");
        return jsonResponse({
          id: "PAYPAL_ORDER",
          status: "CREATED",
          links: [
            {
              rel: "approve",
              href: "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL_ORDER",
            },
          ],
        });
      }
      throw new Error(path);
    }, clock);
    const config = paypalConfig();
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      returnUrl: "https://app.example.com/billing/return",
      config,
    });
    expect(session.status).toBe("pending");
    expect(session.checkoutUrl).toContain("checkoutnow");
    await adapter.healthCheck(config, { remote: true });
    expect(tokenCalls).toBe(1);
  });

  it("does not treat buyer approval as payment; capture completed fulfills", async () => {
    const adapter = new PaypalPaymentAdapter(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/oauth2/token") {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      if (path === "/v1/notifications/verify-webhook-signature") {
        return jsonResponse({ verification_status: "SUCCESS" });
      }
      if (path.endsWith("/capture")) {
        return jsonResponse({
          id: "PAYPAL_ORDER",
          status: "COMPLETED",
          purchase_units: [
            {
              custom_id: "ord_1",
              invoice_id: "att_1",
              payments: {
                captures: [
                  {
                    id: "CAPTURE_1",
                    status: "COMPLETED",
                    amount: { currency_code: "USD", value: "12.00" },
                    custom_id: "ord_1",
                    invoice_id: "att_1",
                  },
                ],
              },
            },
          ],
        });
      }
      throw new Error(path);
    }, clock);
    const config = paypalConfig();
    const approved = await adapter.verifyWebhook(
      Buffer.from(
        JSON.stringify({
          id: "WH-APPROVED",
          event_type: "CHECKOUT.ORDER.APPROVED",
          resource: { id: "PAYPAL_ORDER", status: "APPROVED" },
        }),
      ),
      paypalHeaders(),
      config,
    );
    expect(approved.status).toBe("ignored");
    const captured = await adapter.completeCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      providerRef: "PAYPAL_ORDER",
      amountCents: 1200,
      currency: "USD",
      config,
    });
    expect(captured.status).toBe("succeeded");
    expect(captured.amountCents).toBe(1200);
    const completed = await adapter.verifyWebhook(
      Buffer.from(
        JSON.stringify({
          id: "WH-CAPTURE",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: {
            id: "CAPTURE_1",
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "12.00" },
            custom_id: "ord_1",
            invoice_id: "att_1",
          },
        }),
      ),
      paypalHeaders(),
      config,
    );
    expect(completed.status).toBe("succeeded");
    expect(completed.amountCents).toBe(1200);
  });

  it("rejects webhook verification failure from the official API", async () => {
    const adapter = new PaypalPaymentAdapter(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/oauth2/token")
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      return jsonResponse({ verification_status: "FAILURE" });
    }, clock);
    await expect(
      adapter.verifyWebhook(
        Buffer.from(
          JSON.stringify({ id: "WH-X", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }),
        ),
        paypalHeaders(),
        paypalConfig(),
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
  });

  it("maps capture denied/refunded and optional subscription events", async () => {
    const adapter = new PaypalPaymentAdapter(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/oauth2/token")
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      return jsonResponse({ verification_status: "SUCCESS" });
    }, clock);
    const config = paypalConfig({
      credentials: {
        ...paypalConfig().credentials,
        paypalPlanId: "P-PLAN",
        subscriptionWebhookEnabled: "true",
      },
    });
    const denied = await adapter.verifyWebhook(
      Buffer.from(
        JSON.stringify({
          id: "WH-DENY",
          event_type: "PAYMENT.CAPTURE.DENIED",
          resource: {
            id: "CAPTURE_X",
            custom_id: "ord_1",
            amount: { currency_code: "USD", value: "12.00" },
          },
        }),
      ),
      paypalHeaders(),
      config,
    );
    expect(denied.status).toBe("failed");
    const refunded = await adapter.verifyWebhook(
      Buffer.from(
        JSON.stringify({
          id: "WH-RF",
          event_type: "PAYMENT.CAPTURE.REFUNDED",
          resource: { id: "RF" },
        }),
      ),
      paypalHeaders(),
      config,
    );
    expect(refunded.status).toBe("ignored");
    const sale = await adapter.verifyWebhook(
      Buffer.from(
        JSON.stringify({
          id: "WH-SALE",
          event_type: "PAYMENT.SALE.COMPLETED",
          resource: { id: "SALE_1", custom: "ord_1", amount: { total: "12.00", currency: "USD" } },
        }),
      ),
      paypalHeaders(),
      config,
    );
    expect(sale.status).toBe("pending");
    expect(sale.requiresQuery).toBe(true);
  });

  it("queries captures and refunds captured payments", async () => {
    const adapter = new PaypalPaymentAdapter(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/oauth2/token")
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      if (path.startsWith("/v2/checkout/orders/")) {
        return jsonResponse({}, 404);
      }
      if (path.startsWith("/v2/payments/captures/") && path.endsWith("/refund")) {
        return jsonResponse({ id: "RF_1", status: "COMPLETED" });
      }
      if (path.startsWith("/v2/payments/captures/")) {
        return jsonResponse({
          id: "CAPTURE_1",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "12.00" },
          custom_id: "ord_1",
          invoice_id: "att_1",
        });
      }
      throw new Error(path);
    }, clock);
    const query = await adapter.queryPayment("CAPTURE_1", paypalConfig());
    expect(query.status).toBe("succeeded");
    const refund = await adapter.refund(
      {
        orderId: "ord_1",
        attemptId: "att_1",
        providerRef: "CAPTURE_1",
        amountCents: 1200,
        currency: "USD",
        idempotencyKey: "rf_pp",
      },
      paypalConfig(),
    );
    expect(refund.status).toBe("succeeded");
  });

  it("health-checks credential shape without remote calls; redacts secrets", async () => {
    const adapter = new PaypalPaymentAdapter(async () => {
      throw new Error("network should not run");
    }, clock);
    const health = await adapter.healthCheck(paypalConfig());
    expect(health.ok).toBe(true);
    expect(health.diagnostics?.remoteTested).toBe(false);
    expect(JSON.stringify(health)).not.toContain("client_secret_paypal_yy");
  });

  it("rejects custom gateway hosts (SSRF)", async () => {
    await expect(
      new PaypalPaymentAdapter(undefined, clock).createCheckout({
        orderId: "ord_1",
        attemptId: "att_1",
        amountCents: 100,
        currency: "USD",
        config: paypalConfig({
          credentials: {
            ...paypalConfig().credentials,
            apiBase: "https://evil.example",
          },
        }),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("does not fake recurring Checkout when plan IDs are only stored", async () => {
    const adapter = new PaypalPaymentAdapter(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/oauth2/token")
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      expect(path).toBe("/v2/checkout/orders");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body).not.toHaveProperty("plan_id");
      expect(body.intent).toBe("CAPTURE");
      return jsonResponse({
        id: "PAYPAL_ORDER",
        links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=x" }],
      });
    }, clock);
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 9900,
      currency: "USD",
      config: paypalConfig({
        credentials: { ...paypalConfig().credentials, paypalPlanId: "P-PLAN" },
      }),
    });
    expect(session.status).toBe("pending");
  });
});
