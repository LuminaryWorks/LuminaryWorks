import { EntitlementException } from "../src/common/errors";
import { ERROR_HTTP_STATUS } from "../src/common/constants";
import { DoerflowCreditPaymentAdapter } from "../src/modules/payments/doerflow-credit.adapter";
import {
  assertLedgerAmountMatch,
  computeDoerflowWebhookSignature,
  deriveChargeEventId,
  deriveChargeIdempotencyKey,
  ledgerAmountMinorToCents,
  MERCHANT_CHARGE_EVENT_TYPE,
  toLedgerAmountMinor,
} from "../src/modules/payments/doerflow-credit";
import { doerflowCreditConfig, jsonResponse } from "./payment-adapter-fixtures";

const fixedNow = new Date("2026-09-17T04:00:00Z");
const clock = { now: () => fixedNow };

function readBody(body: BodyInit | null | undefined): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return Buffer.from(body).toString("utf8");
  }
  return String(body);
}

function chargeSucceeded(overrides: Record<string, unknown> = {}) {
  const idempotencyKey = deriveChargeIdempotencyKey("ord_1", "att_1");
  return {
    status: "succeeded",
    chargeId: "chg_1",
    ledgerOpId: "lop_1",
    eventId: deriveChargeEventId(idempotencyKey),
    assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amountMinor: toLedgerAmountMinor(1200),
    remainingMinor: "1000000",
    replayed: false,
    ...overrides,
  };
}

function webhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    eventType: MERCHANT_CHARGE_EVENT_TYPE,
    eventId: deriveChargeEventId(deriveChargeIdempotencyKey("ord_1", "att_1")),
    orderId: "ord_1",
    chargeId: "chg_1",
    status: "succeeded",
    amountMinor: toLedgerAmountMinor(1200),
    currency: "USD",
    asset: "USDC",
    merchantAccount: "acct_lw_platform",
    settledAt: fixedNow.toISOString(),
    ...overrides,
  };
}

function signedWebhook(
  payload: Record<string, unknown>,
  secret: string,
  opts?: { timestamp?: string; nonce?: string; tamper?: (raw: Buffer) => Buffer },
) {
  const timestamp = opts?.timestamp ?? String(Math.floor(fixedNow.getTime() / 1000));
  const nonce = opts?.nonce ?? "nonce_fixture_01";
  let body = Buffer.from(JSON.stringify(payload));
  const headers = {
    "x-lw-timestamp": timestamp,
    "x-lw-nonce": nonce,
    "x-lw-signature": `v1=${computeDoerflowWebhookSignature(secret, timestamp, nonce, body)}`,
  };
  if (opts?.tamper) body = Buffer.from(opts.tamper(body));
  return { body, headers };
}

describe("doerflow_credit adapter", () => {
  const config = doerflowCreditConfig();
  const secret = config.credentials.webhookSecret;

  it("pins deriveChargeEventId to the golden value", () => {
    expect(deriveChargeEventId("idem_abc_123")).toBe("dfc_8ee1c0d96304b7d79da258f4cb23ca17");
  });

  it("maps LEDGER_INSUFFICIENT_FUNDS to HTTP 402", () => {
    expect(ERROR_HTTP_STATUS.LEDGER_INSUFFICIENT_FUNDS).toBe(402);
    const ex = new EntitlementException("LEDGER_INSUFFICIENT_FUNDS", "insufficient");
    expect(ex.getStatus()).toBe(402);
  });

  it("creates a charge with server snapshot amounts and a deterministic idempotencyKey", async () => {
    const seen: Array<{ url?: string; body?: string; key?: string }> = [];
    const adapter = new DoerflowCreditPaymentAdapter(async (url, init) => {
      seen.push({
        url: String(url),
        body: readBody(init?.body),
        key: (init?.headers as Record<string, string>)?.["X-Service-Key"],
      });
      return jsonResponse(chargeSucceeded());
    }, clock);
    const input = {
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      subjectId: "user_1",
      config,
    };
    const first = await adapter.createCheckout(input);
    const second = await adapter.createCheckout(input);
    expect(seen).toHaveLength(2);
    const parsed = JSON.parse(seen[0]?.body ?? "{}") as Record<string, unknown>;
    expect(new URL(seen[0]?.url ?? "").pathname).toBe("/api/v1/payments/merchant/charges");
    expect(parsed.orderId).toBe("ord_1");
    expect(parsed.subjectId).toBe("user_1");
    expect(parsed.amountMinor).toBe(toLedgerAmountMinor(1200));
    expect(parsed.currency).toBe("USD");
    expect(parsed.asset).toBe("USDC");
    expect(parsed.chainId).toBe(8453);
    expect(parsed.idempotencyKey).toBe(deriveChargeIdempotencyKey("ord_1", "att_1"));
    expect(parsed.idempotencyKey).toBe(JSON.parse(seen[1]?.body ?? "{}").idempotencyKey);
    expect(seen[0]?.key).toBe(config.credentials.serviceKey);
    expect(first.checkoutUrl).toBeNull();
    expect(first.status).toBe("pending");
    expect(first.providerRef).toBe("chg_1");
    expect(second.providerRef).toBe("chg_1");
  });

  it("accepts a valid HMAC webhook over the raw body", async () => {
    const adapter = new DoerflowCreditPaymentAdapter(undefined, clock);
    const signed = signedWebhook(webhookPayload(), secret);
    const verified = await adapter.verifyWebhook(signed.body, signed.headers, config);
    expect(verified.status).toBe("succeeded");
    expect(verified.eventId).toBe(
      deriveChargeEventId(deriveChargeIdempotencyKey("ord_1", "att_1")),
    );
    expect(verified.amountCents).toBe(1200);
    expect(verified.merchantId).toBe("acct_lw_platform");
  });

  it("rejects a tampered body even when the original signature is attached", async () => {
    const adapter = new DoerflowCreditPaymentAdapter(undefined, clock);
    const signed = signedWebhook(webhookPayload(), secret, {
      tamper: (raw) => Buffer.from(raw.toString("utf8").replace("1200", "9999")),
    });
    await expect(adapter.verifyWebhook(signed.body, signed.headers, config)).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });
  });

  it("rejects a bad signature", async () => {
    const adapter = new DoerflowCreditPaymentAdapter(undefined, clock);
    const signed = signedWebhook(webhookPayload(), secret);
    await expect(
      adapter.verifyWebhook(
        signed.body,
        { ...signed.headers, "x-lw-signature": "v1=deadbeef" },
        config,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
  });

  it("rejects a stale timestamp outside the partner replay window", async () => {
    const adapter = new DoerflowCreditPaymentAdapter(undefined, clock);
    const stale = String(Math.floor(fixedNow.getTime() / 1000) - 400);
    const signed = signedWebhook(webhookPayload(), secret, { timestamp: stale });
    await expect(adapter.verifyWebhook(signed.body, signed.headers, config)).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });
  });

  it("rejects an amount mismatch even when the signature is valid", async () => {
    const adapter = new DoerflowCreditPaymentAdapter(
      async () => jsonResponse(chargeSucceeded()),
      clock,
    );
    await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "USD",
      subjectId: "user_1",
      config,
    });
    const signed = signedWebhook(
      webhookPayload({ amountMinor: toLedgerAmountMinor(1300) }),
      secret,
      { nonce: "nonce_mismatch_01" },
    );
    await expect(adapter.verifyWebhook(signed.body, signed.headers, config)).rejects.toMatchObject({
      code: "PAYMENT_AMOUNT_MISMATCH",
    });
  });

  it("compares ledger amounts with BigInt rather than Number", () => {
    expect(toLedgerAmountMinor(1200)).toBe("12000000");
    expect(ledgerAmountMinorToCents("12000000")).toBe(1200);
    expect(() => assertLedgerAmountMatch("12000000", "12000000")).not.toThrow();
    expect(() => assertLedgerAmountMatch("12000000", "13000000")).toThrow(EntitlementException);
    try {
      assertLedgerAmountMatch("12000000", "13000000");
    } catch (err) {
      expect(err).toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH" });
    }
  });

  it("maps insufficient-funds responses to LEDGER_INSUFFICIENT_FUNDS", async () => {
    const adapter = new DoerflowCreditPaymentAdapter(async () => {
      return jsonResponse(
        {
          status: "insufficient_funds",
          code: "LEDGER_INSUFFICIENT_FUNDS",
          message: "available balance below charge",
          eventId: deriveChargeEventId(deriveChargeIdempotencyKey("ord_1", "att_1")),
        },
        402,
      );
    }, clock);
    await expect(
      adapter.createCheckout({
        orderId: "ord_1",
        attemptId: "att_1",
        amountCents: 1200,
        currency: "USD",
        subjectId: "user_1",
        config,
      }),
    ).rejects.toMatchObject({ code: "LEDGER_INSUFFICIENT_FUNDS" });
  });

  it("health-checks credential shape locally, probes remotely only on demand, and leaks no secrets", async () => {
    let remote = 0;
    const adapter = new DoerflowCreditPaymentAdapter(async (url) => {
      remote += 1;
      expect(String(url)).toContain("/api/v1/payments/merchant/health");
      return jsonResponse({ ok: true });
    }, clock);
    const local = await adapter.healthCheck(config);
    expect(local.ok).toBe(true);
    expect(remote).toBe(0);
    const serialized = JSON.stringify(local);
    expect(serialized).not.toContain(config.credentials.serviceKey);
    expect(serialized).not.toContain(config.credentials.webhookSecret);
    const remoteHealth = await adapter.healthCheck(config, { remote: true });
    expect(remoteHealth.ok).toBe(true);
    expect(remoteHealth.diagnostics?.remoteTested).toBe(true);
    const missing = await adapter.healthCheck({ ...config, credentials: {} });
    expect(missing.ok).toBe(false);
    expect(missing.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(missing)).not.toContain("svc_");
  });
});
