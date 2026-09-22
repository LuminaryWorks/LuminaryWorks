import { createHmac } from "node:crypto";
import { PolarPaymentAdapter } from "../src/modules/payments/polar.adapter";
import { jsonResponse, polarConfig } from "./payment-adapter-fixtures";

const fixedNow = new Date("2026-09-22T12:00:00Z");
const clock = { now: () => fixedNow };

function checkoutObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "chk_test_1",
    status: "open",
    url: "https://sandbox.polar.sh/checkout/chk_test_1",
    total_amount: 1200,
    amount: 1000,
    tax_amount: 200,
    currency: "usd",
    metadata: { orderId: "ord_1", attemptId: "att_1" },
    ...overrides,
  };
}

/** Polar SDK: UTF-8 secret → base64 → HMAC key (Standard Webhooks wire format). */
function polarHmacKey(secret: string): Buffer {
  return Buffer.from(Buffer.from(secret, "utf8").toString("base64"), "base64");
}

function standardWebhookHeaders(body: string, secret: string, now = fixedNow) {
  const id = "msg_polar_fixture_1";
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signed = `${id}.${timestamp}.${body}`;
  const sig = createHmac("sha256", polarHmacKey(secret)).update(signed).digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${sig}`,
  };
}

function readBody(body: BodyInit | null | undefined): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return String(body);
}

function headerAuth(headers: HeadersInit | undefined): string {
  if (!headers) return "";
  if (headers instanceof Headers) return headers.get("authorization") ?? "";
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === "authorization");
    return hit?.[1] ?? "";
  }
  const rec = headers as Record<string, string>;
  return rec.authorization ?? rec.Authorization ?? "";
}

describe("polar MoR adapter", () => {
  const config = polarConfig({
    credentials: {
      apiKey: "polar_oat_fixtureOrganizationAccessTok",
      webhookSecret: "polar_webhook_fixture_secret_value",
      productId: "11111111-2222-4333-8444-555555555555",
      successUrl: "https://app.example.com/billing/return",
    },
  });
  const secret = config.credentials.webhookSecret;

  it("creates a hosted checkout session with the server snapshot amount", async () => {
    const seen: { url?: string; body?: string; auth?: string } = {};
    const adapter = new PolarPaymentAdapter(async (url, init) => {
      seen.url = String(url);
      seen.body = readBody(init?.body);
      seen.auth = headerAuth(init?.headers);
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
    expect(parsed.hostname).toBe("sandbox-api.polar.sh");
    expect(parsed.pathname).toBe("/v1/checkouts/");
    expect(seen.auth).toMatch(/^Bearer polar_oat_/);
    expect(seen.body).toContain('"amount":1200');
    expect(seen.body).toContain("11111111-2222-4333-8444-555555555555");
    expect(seen.body).toContain('"orderId":"ord_1"');
    expect(seen.body).not.toContain("9900");
    expect(session.status).toBe("pending");
    expect(session.checkoutUrl).toBe("https://sandbox.polar.sh/checkout/chk_test_1");
    expect(session.action).toMatchObject({ merchantOfRecord: true });
  });

  it("accepts a valid Standard Webhooks signature and maps order.paid", async () => {
    const adapter = new PolarPaymentAdapter(undefined, clock);
    const payload = {
      id: "evt_1",
      type: "order.paid",
      data: {
        id: "ord_polar_1",
        status: "paid",
        total_amount: 1200,
        currency: "usd",
        metadata: { orderId: "ord_1", attemptId: "att_1" },
      },
    };
    const body = JSON.stringify(payload);
    const verified = await adapter.verifyWebhook(
      Buffer.from(body),
      standardWebhookHeaders(body, secret),
      config,
    );
    expect(verified.status).toBe("succeeded");
    expect(verified.orderId).toBe("ord_1");
    expect(verified.amountCents).toBe(1200);
    expect(JSON.stringify(verified)).not.toContain(secret);
  });

  it("rejects tampered webhook bodies", async () => {
    const adapter = new PolarPaymentAdapter(undefined, clock);
    const body = JSON.stringify({ id: "evt_2", type: "order.paid", data: { id: "x" } });
    const headers = standardWebhookHeaders(body, secret);
    await expect(
      adapter.verifyWebhook(Buffer.from(body + "x"), headers, config),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
  });

  it("queries checkout and refunds via official API", async () => {
    const calls: string[] = [];
    const adapter = new PolarPaymentAdapter(async (url, init) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.includes("/refunds/")) {
        return jsonResponse({ id: "ref_1", status: "succeeded", amount: 400 });
      }
      if (u.includes("/orders/")) {
        return jsonResponse({ items: [{ id: "ord_polar_1" }] });
      }
      return jsonResponse(
        checkoutObject({ status: "succeeded", total_amount: 1200, order_id: "ord_polar_1" }),
      );
    }, clock);
    const query = await adapter.queryPayment("chk_test_1", config);
    expect(query.status).toBe("succeeded");
    expect(query.amountCents).toBe(1200);
    const refund = await adapter.refund(
      {
        orderId: "ord_1",
        attemptId: "att_1",
        providerRef: "chk_test_1",
        amountCents: 400,
        currency: "USD",
        idempotencyKey: "idem_refund_1",
      },
      config,
    );
    expect(refund.status).toBe("succeeded");
    expect(refund.amountCents).toBe(400);
    expect(calls.some((c) => c.includes("/refunds/"))).toBe(true);
  });

  it("health-checks credentials without leaking secrets", async () => {
    const adapter = new PolarPaymentAdapter(undefined, clock);
    const local = await adapter.healthCheck(config);
    expect(local.ok).toBe(true);
    const serialized = JSON.stringify(local);
    expect(serialized).not.toContain(config.credentials.apiKey);
    expect(serialized).not.toContain(config.credentials.webhookSecret);
    const missing = await adapter.healthCheck({ ...config, credentials: {} });
    expect(missing.ok).toBe(false);
    expect(missing.issues.some((issue) => /apiKey|polar/i.test(issue))).toBe(true);
  });
});
