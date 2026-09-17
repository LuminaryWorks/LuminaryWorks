import { hmacSha256Hex } from "../src/common/crypto";
import { EntitlementException } from "../src/common/errors";
import { CreemPaymentAdapter } from "../src/modules/payments/creem.adapter";
import { PaymentWebhookService } from "../src/modules/payments/payment-webhook.service";
import { PaymentsService } from "../src/modules/payments/payments.service";
import type { OrderEntity } from "../src/database/entities/order.entity";
import type { PaymentAttemptEntity } from "../src/database/entities/payment-attempt.entity";
import { creemConfig, jsonResponse } from "./payment-adapter-fixtures";

const fixedNow = new Date("2026-09-07T12:00:00Z");
const clock = { now: () => fixedNow };

function checkoutObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch_test_1",
    object: "checkout",
    status: "pending",
    checkout_url: "https://checkout.creem.io/ch_test_1",
    request_id: "ord_1",
    custom_price: 1200,
    metadata: { orderId: "ord_1", attemptId: "att_1" },
    ...overrides,
  };
}

function signedEvent(
  payload: Record<string, unknown>,
  secret: string,
  createdAt = fixedNow.getTime(),
) {
  const body = JSON.stringify({ created_at: createdAt, ...payload });
  return {
    body: Buffer.from(body),
    headers: { "creem-signature": hmacSha256Hex(secret, body) },
  };
}

function readBody(body: BodyInit | null | undefined): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return String(body);
}

describe("creem MoR adapter", () => {
  const config = creemConfig();
  const secret = config.credentials.webhookSecret;

  it("creates a hosted checkout session with the server snapshot amount", async () => {
    const seen: { url?: string; body?: string; apiKey?: string } = {};
    const adapter = new CreemPaymentAdapter(async (url, init) => {
      seen.url = String(url);
      seen.body = readBody(init?.body);
      seen.apiKey = String(init?.headers && (init.headers as Record<string, string>)["x-api-key"]);
      return jsonResponse(checkoutObject());
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
    expect(parsed.hostname).toBe("test-api.creem.io");
    expect(parsed.pathname).toBe("/v1/checkouts");
    expect(seen.body).toContain('"custom_price":1200');
    expect(seen.body).toContain('"product_id":"prod_fixtureProduct01"');
    expect(seen.body).toContain('"orderId":"ord_1"');
    expect(seen.body).not.toContain("9900");
    expect(session.status).toBe("pending");
    expect(session.checkoutUrl).toBe("https://checkout.creem.io/ch_test_1");
    expect(session.action).toMatchObject({ merchantOfRecord: true });
  });

  it("accepts a valid creem-signature and rejects tampered bodies", async () => {
    const adapter = new CreemPaymentAdapter(undefined, clock);
    const paid = signedEvent(
      {
        id: "evt_paid",
        eventType: "checkout.completed",
        object: {
          id: "ch_test_1",
          object: "checkout",
          status: "completed",
          request_id: "ord_1",
          metadata: { orderId: "ord_1", attemptId: "att_1" },
          amount_paid: 1200,
          amount: 1000,
          tax_amount: 200,
          currency: "USD",
        },
      },
      secret,
    );
    const verified = await adapter.verifyWebhook(paid.body, paid.headers, config);
    expect(verified.status).toBe("succeeded");
    expect(verified.amountCents).toBe(1200);
    const tampered = Buffer.from(paid.body.toString("utf8").replace("1200", "9999"));
    await expect(adapter.verifyWebhook(tampered, paid.headers, config)).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });
  });

  it("rejects a stale webhook timestamp", async () => {
    const adapter = new CreemPaymentAdapter(undefined, clock);
    const stale = signedEvent(
      {
        id: "evt_stale",
        eventType: "checkout.completed",
        object: {
          id: "ch_test_1",
          object: "checkout",
          status: "completed",
          amount_paid: 1200,
          currency: "USD",
          metadata: { orderId: "ord_1", attemptId: "att_1" },
        },
      },
      secret,
      fixedNow.getTime() - 6 * 60 * 1000,
    );
    await expect(adapter.verifyWebhook(stale.body, stale.headers, config)).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });
  });

  it("rejects a webhook whose net equals the order total but whose gross does not", async () => {
    const adapter = new CreemPaymentAdapter(undefined, clock);
    const paid = signedEvent(
      {
        id: "evt_gross",
        eventType: "checkout.completed",
        object: {
          id: "ch_test_1",
          object: "checkout",
          status: "completed",
          request_id: "ord_1",
          metadata: { orderId: "ord_1", attemptId: "att_1" },
          gross: 1500,
          net: 1200,
          tax: 300,
          currency: "USD",
        },
      },
      secret,
    );
    const verified = await adapter.verifyWebhook(paid.body, paid.headers, config);
    expect(verified.amountCents).toBe(1500);
    expect(verified.payload.netCents).toBe(1200);
    const payments = new PaymentsService(
      { getOrThrow: () => ({}) } as never,
      { transaction: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { find: jest.fn() } as never,
      {} as never,
      { get: jest.fn() } as never,
      { marketFor: () => "GLOBAL" } as never,
      { record: jest.fn() } as never,
    );
    try {
      payments.assertSnapshotMatch(
        { amountCents: 1200, currency: "USD" } as OrderEntity,
        { amountCents: 1200, merchantId: "creem-store" } as PaymentAttemptEntity,
        { amountCents: verified.amountCents, currency: verified.currency },
      );
      throw new Error("expected PAYMENT_AMOUNT_MISMATCH");
    } catch (err) {
      expect(err).toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH" });
    }
  });

  it("recognises a MoR-initiated refund and revokes via the shared refund path", async () => {
    const adapter = new CreemPaymentAdapter(undefined, clock);
    const refundEvent = signedEvent(
      {
        id: "evt_rf_mor",
        eventType: "refund.created",
        object: {
          id: "ref_1",
          object: "refund",
          status: "succeeded",
          refund_amount: 1200,
          refund_currency: "USD",
          reason: "requested_by_customer",
          transaction: {
            amount: 1000,
            amount_paid: 1200,
            tax_amount: 200,
            currency: "USD",
            status: "refunded",
          },
          checkout: {
            id: "ch_test_1",
            object: "checkout",
            request_id: "ord_1",
            metadata: { orderId: "ord_1", attemptId: "att_1" },
          },
        },
      },
      secret,
    );
    const verified = await adapter.verifyWebhook(refundEvent.body, refundEvent.headers, config);
    expect(verified.status).toBe("refunded");
    expect(verified.amountCents).toBe(1200);
    expect(verified.payload.inbound).toBe(true);

    const order = { id: "ord_1", status: "fulfilled", amountCents: 1200, currency: "USD" };
    const inbound = jest
      .fn()
      .mockResolvedValue({ refund: { id: "rf_1" }, order, idempotent: false });
    const webhook = new PaymentWebhookService(
      { transaction: jest.fn() } as never,
      {
        create: jest.fn((row: unknown) => row),
        save: jest.fn().mockResolvedValue(undefined),
        update: jest.fn(),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue({
          id: "att_1",
          orderId: "ord_1",
          status: "succeeded",
          providerRef: "ch_test_1",
        }),
      } as never,
      { findOne: jest.fn().mockResolvedValue(order) } as never,
      {
        loadEnabled: jest.fn().mockResolvedValue({
          id: config.id,
          providerId: "creem",
          enabled: true,
          status: "active",
        }),
        adapterFor: () => adapter,
        decryptCurrentAndPrevious: () => [config],
        decryptForAdapter: () => config,
      } as never,
      {
        rawBodySha256: () => "hash",
        applyInboundRefund: inbound,
        assertSnapshotMatch: () => {
          throw new Error("fulfilment snapshot must not run for MoR refunds");
        },
      } as never,
      { record: jest.fn() } as never,
    );
    const result = await webhook.handlePublic({
      provider: "creem",
      configId: config.id,
      rawBody: refundEvent.body,
      headers: refundEvent.headers,
    });
    expect(result.body).toEqual({ received: true });
    expect(inbound).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "ord_1",
        amountCents: 1200,
        eventId: "evt_rf_mor",
        actor: "payment-webhook",
      }),
    );

    const savedOrder = { id: "ord_1", status: "fulfilled", amountCents: 1200, currency: "USD" };
    const payments = new PaymentsService(
      { getOrThrow: () => ({}) } as never,
      {
        transaction: async (
          fn: (manager: {
            findOne: jest.Mock;
            find: jest.Mock;
            save: jest.Mock;
          }) => Promise<unknown>,
        ) =>
          fn({
            findOne: jest.fn().mockResolvedValue(savedOrder),
            find: jest.fn().mockResolvedValue([]),
            save: jest.fn(async (row: { status?: string }) => {
              if (row.status) savedOrder.status = row.status;
              return row;
            }),
          }),
      } as never,
      { findOne: jest.fn().mockResolvedValue(savedOrder) } as never,
      { findOne: jest.fn() } as never,
      {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((row: Record<string, unknown>) => ({ id: "rf_in", ...row })),
        save: jest.fn(async (row: unknown) => row),
      } as never,
      {} as never,
      { get: jest.fn() } as never,
      { marketFor: () => "GLOBAL" } as never,
      { record: jest.fn() } as never,
    );
    await payments.applyInboundRefund({
      orderId: "ord_1",
      attemptId: "att_1",
      providerRef: "ch_test_1",
      amountCents: 1200,
      currency: "USD",
      eventId: "evt_rf_mor",
      reason: "requested_by_customer",
      actor: "payment-webhook",
    });
    expect(savedOrder.status).toBe("refunded");
  });

  it("queries checkout status and supports partial refunds", async () => {
    const adapter = new CreemPaymentAdapter(async (url, init) => {
      const parsed = new URL(String(url));
      expect(parsed.hostname).toBe("test-api.creem.io");
      if (parsed.pathname === "/v1/refunds") {
        expect(readBody(init?.body)).toContain('"refund_amount":400');
        expect(readBody(init?.body)).toContain('"transaction_id":"tran_1"');
        return jsonResponse({ id: "ref_partial", status: "succeeded", refund_amount: 400 });
      }
      if (parsed.pathname === "/v1/checkouts") {
        return jsonResponse(
          checkoutObject({
            status: "completed",
            amount_paid: 1200,
            amount: 1000,
            tax_amount: 200,
            currency: "USD",
            order: { transaction: "tran_1", amount_paid: 1200, amount: 1000, currency: "USD" },
          }),
        );
      }
      return jsonResponse({ status: 404 });
    }, clock);
    const query = await adapter.queryPayment("ch_test_1", config);
    expect(query.status).toBe("succeeded");
    expect(query.amountCents).toBe(1200);
    const refund = await adapter.refund(
      {
        orderId: "ord_1",
        attemptId: "att_1",
        providerRef: "ch_test_1",
        amountCents: 400,
        currency: "USD",
        idempotencyKey: "rf_1",
      },
      config,
    );
    expect(refund.status).toBe("succeeded");
    expect(refund.amountCents).toBe(400);
  });

  it("health-checks credential shape locally and leaks no secret values", async () => {
    let remote = 0;
    const adapter = new CreemPaymentAdapter(async (url) => {
      remote += 1;
      expect(String(url)).toContain("/v1/products/search");
      return jsonResponse({ items: [] });
    }, clock);
    const local = await adapter.healthCheck(config);
    expect(local.ok).toBe(true);
    expect(remote).toBe(0);
    const serialized = JSON.stringify(local);
    expect(serialized).not.toContain(config.credentials.apiKey);
    expect(serialized).not.toContain(config.credentials.webhookSecret);
    const remoteHealth = await adapter.healthCheck(config, { remote: true });
    expect(remoteHealth.ok).toBe(true);
    expect(remoteHealth.diagnostics?.remoteTested).toBe(true);
    const missing = await adapter.healthCheck({ ...config, credentials: {} });
    expect(missing.ok).toBe(false);
    expect(missing.issues.some((issue) => /apiKey|credential/i.test(issue))).toBe(true);
    expect(JSON.stringify(missing)).not.toContain("creem_test_fixtureapikeyvalue");
    const mismatched = await adapter.healthCheck({ ...config, environment: "live" });
    expect(mismatched.ok).toBe(false);
  });

  it("times out official HTTPS calls", async () => {
    const adapter = new CreemPaymentAdapter(async () => {
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
