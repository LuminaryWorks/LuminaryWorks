import { createHmac } from "node:crypto";
import { PaddlePaymentAdapter } from "../src/modules/payments/paddle.adapter";
import { jsonResponse, paddleConfig } from "./payment-adapter-fixtures";

const fixedNow = new Date("2026-09-22T12:00:00Z");
const clock = { now: () => fixedNow };

function transactionObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "txn_01fixturetransaction000001",
    status: "ready",
    currency_code: "USD",
    checkout: {
      url: "https://app.example.com/billing/checkout?_ptxn=txn_01fixturetransaction000001",
    },
    custom_data: { orderId: "ord_1", attemptId: "att_1", amountCents: "1200" },
    details: {
      totals: {
        subtotal: "1000",
        tax: "200",
        total: "1200",
        earnings: "900",
        currency_code: "USD",
      },
      line_items: [{ id: "txnitm_01fixturelineitem000001", quantity: 1 }],
    },
    ...overrides,
  };
}

function paddleEnvelope(data: Record<string, unknown>) {
  return { data, meta: { request_id: "req_fixture_1" } };
}

/** Paddle Billing: HMAC-SHA256 hex over `${ts}:${rawBody}`. */
function paddleSignatureHeaders(body: string, secret: string, now = fixedNow) {
  const ts = String(Math.floor(now.getTime() / 1000));
  const signed = `${ts}:${body}`;
  const h1 = createHmac("sha256", secret).update(signed).digest("hex");
  return {
    "paddle-signature": `ts=${ts};h1=${h1}`,
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

function headerPaddleVersion(headers: HeadersInit | undefined): string {
  if (!headers) return "";
  if (headers instanceof Headers) return headers.get("paddle-version") ?? "";
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === "paddle-version");
    return hit?.[1] ?? "";
  }
  const rec = headers as Record<string, string>;
  return rec["paddle-version"] ?? rec["Paddle-Version"] ?? "";
}

describe("paddle MoR adapter", () => {
  const config = paddleConfig();
  const secret = config.credentials.webhookSecret;

  it("creates a hosted checkout transaction on the sandbox API", async () => {
    const seen: { url?: string; body?: string; auth?: string; version?: string } = {};
    const adapter = new PaddlePaymentAdapter(async (url, init) => {
      seen.url = String(url);
      seen.body = readBody(init?.body);
      seen.auth = headerAuth(init?.headers);
      seen.version = headerPaddleVersion(init?.headers);
      return jsonResponse(paddleEnvelope(transactionObject()));
    }, clock);
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      returnUrl: "https://app.example.com/billing/checkout",
      config,
    });
    const parsed = new URL(seen.url ?? "");
    expect(parsed.hostname).toBe("sandbox-api.paddle.com");
    expect(parsed.pathname).toBe("/transactions");
    expect(seen.auth).toMatch(/^Bearer pdl_sdbx_apikey_/);
    expect(seen.version).toBe("1");
    expect(seen.body).toContain("pri_01fixturepriceid0000000001");
    expect(seen.body).toContain('"orderId":"ord_1"');
    expect(seen.body).toContain('"amountCents":"1200"');
    expect(session.status).toBe("pending");
    expect(session.checkoutUrl).toContain("_ptxn=txn_01fixturetransaction000001");
    expect(session.action).toMatchObject({ merchantOfRecord: true });
  });

  it("accepts a valid Paddle-Signature and maps transaction.completed", async () => {
    const adapter = new PaddlePaymentAdapter(undefined, clock);
    const payload = {
      event_id: "evt_01fixture",
      event_type: "transaction.completed",
      data: transactionObject({ status: "completed" }),
    };
    const body = JSON.stringify(payload);
    const verified = await adapter.verifyWebhook(
      Buffer.from(body),
      paddleSignatureHeaders(body, secret),
      config,
    );
    expect(verified.status).toBe("succeeded");
    expect(verified.orderId).toBe("ord_1");
    expect(verified.amountCents).toBe(1200);
    expect(JSON.stringify(verified)).not.toContain(secret);
  });

  it("rejects tampered webhook bodies", async () => {
    const adapter = new PaddlePaymentAdapter(undefined, clock);
    const body = JSON.stringify({
      event_id: "evt_2",
      event_type: "transaction.completed",
      data: { id: "txn_x" },
    });
    const headers = paddleSignatureHeaders(body, secret);
    await expect(
      adapter.verifyWebhook(Buffer.from(body + "x"), headers, config),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
  });

  it("queries transactions and refunds via adjustments", async () => {
    const calls: string[] = [];
    const adapter = new PaddlePaymentAdapter(async (url, init) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.includes("/adjustments")) {
        return jsonResponse(
          paddleEnvelope({
            id: "adj_01fixture",
            status: "approved",
            totals: { total: "400", currency_code: "USD" },
          }),
        );
      }
      return jsonResponse(
        paddleEnvelope(transactionObject({ status: "completed", id: "txn_01fixturetransaction000001" })),
      );
    }, clock);
    const query = await adapter.queryPayment("txn_01fixturetransaction000001", config);
    expect(query.status).toBe("succeeded");
    expect(query.amountCents).toBe(1200);
    const refund = await adapter.refund(
      {
        orderId: "ord_1",
        attemptId: "att_1",
        providerRef: "txn_01fixturetransaction000001",
        amountCents: 400,
        currency: "USD",
        idempotencyKey: "idem_refund_1",
      },
      config,
    );
    expect(refund.status).toBe("succeeded");
    expect(refund.amountCents).toBe(400);
    expect(calls.some((c) => c.includes("/adjustments"))).toBe(true);
    const adjustCall = calls.find((c) => c.includes("POST") && c.includes("/adjustments"));
    expect(adjustCall).toBeTruthy();
  });

  it("health-checks credentials without leaking secrets", async () => {
    const adapter = new PaddlePaymentAdapter(undefined, clock);
    const local = await adapter.healthCheck(config);
    expect(local.ok).toBe(true);
    const serialized = JSON.stringify(local);
    expect(serialized).not.toContain(config.credentials.apiKey);
    expect(serialized).not.toContain(config.credentials.webhookSecret);
    const missing = await adapter.healthCheck({ ...config, credentials: {} });
    expect(missing.ok).toBe(false);
    expect(missing.issues.some((issue) => /apiKey|paddle|priceId/i.test(issue))).toBe(true);
  });
});
