import { QueryFailedError } from "typeorm";
import { EntitlementException } from "../src/common/errors";
import {
  yuanFromMinor,
  minorFromYuan,
  signAlipayRequest,
} from "../src/modules/payments/alipay-protocol";
import { AlipayF2fPaymentAdapter } from "../src/modules/payments/alipay-f2f.adapter";
import { PAYMENT_HTTP_TIMEOUT_MS, paymentFetch } from "../src/modules/payments/payment-http";
import { PaymentWebhookService } from "../src/modules/payments/payment-webhook.service";
import {
  alipayNotifyBody,
  makeAlipayBundle,
  signedGatewayJson,
  textResponse,
} from "./payment-adapter-fixtures";

const fixedNow = new Date("2026-09-07T12:00:00Z");

describe("alipay_f2f adapter", () => {
  const bundle = makeAlipayBundle();
  const clock = { now: () => fixedNow };

  it("signs canonical OpenAPI parameters with RSA2 and excludes sign", () => {
    const params = {
      app_id: "2021000000000001",
      method: "alipay.trade.precreate",
      sign_type: "RSA2",
      charset: "utf-8",
      biz_content: '{"out_trade_no":"att_1"}',
    };
    const sign = signAlipayRequest(params, bundle.merchant.privateKey);
    expect(sign.length).toBeGreaterThan(80);
    expect(params).not.toHaveProperty("sign");
  });

  it("converts CNY minor units strictly and rejects malformed decimals", () => {
    expect(yuanFromMinor(1234, "CNY")).toBe("12.34");
    expect(minorFromYuan("12.34")).toBe(1234);
    expect(minorFromYuan("12.3")).toBe(1230);
    expect(() => yuanFromMinor(1234, "USD")).toThrow(EntitlementException);
    expect(() => minorFromYuan("12.345")).toThrow(EntitlementException);
    expect(() => minorFromYuan("1e2")).toThrow(EntitlementException);
    expect(() => minorFromYuan("-1.00")).toThrow(EntitlementException);
  });

  it("creates a QR via alipay.trade.precreate using notify_url from encrypted config", async () => {
    const adapter = new AlipayF2fPaymentAdapter(async (url, init) => {
      expect(String(url)).toContain("openapi-sandbox.dl.alipaydev.com");
      const body = String(init?.body ?? "");
      expect(body).toContain("alipay.trade.precreate");
      expect(body).toContain(encodeURIComponent(bundle.config.credentials.notifyUrl));
      expect(body).toContain("12.00");
      return textResponse(
        signedGatewayJson(
          "alipay.trade.precreate",
          {
            code: "10000",
            msg: "Success",
            out_trade_no: "att_1",
            qr_code: "https://qr.alipay.com/bax123",
          },
          bundle.platform.privateKey,
        ),
      );
    }, clock);
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 1200,
      currency: "CNY",
      config: bundle.config,
    });
    expect(session.status).toBe("pending");
    expect(session.qrPayload).toContain("qr.alipay.com");
  });

  it("maps WAIT_BUYER_PAY / TRADE_SUCCESS / TRADE_FINISHED / TRADE_CLOSED", async () => {
    const adapter = new AlipayF2fPaymentAdapter(undefined, clock);
    const base = {
      app_id: "2021000000000001",
      out_trade_no: "att_1",
      passback_params: "ord_1",
      seller_id: "2088000000000001",
      total_amount: "12.00",
      trade_no: "2026090722001400000001",
    };
    const pending = await adapter.verifyWebhook(
      alipayNotifyBody(
        { ...base, notify_id: "n_wait", trade_status: "WAIT_BUYER_PAY" },
        bundle.platform.privateKey,
      ),
      {},
      bundle.config,
    );
    expect(pending.status).toBe("pending");
    const paid = await adapter.verifyWebhook(
      alipayNotifyBody(
        { ...base, notify_id: "n_ok", trade_status: "TRADE_SUCCESS" },
        bundle.platform.privateKey,
      ),
      {},
      bundle.config,
    );
    expect(paid.status).toBe("succeeded");
    expect(paid.ack?.body).toBe("success");
    const finished = await adapter.verifyWebhook(
      alipayNotifyBody(
        { ...base, notify_id: "n_fin", trade_status: "TRADE_FINISHED" },
        bundle.platform.privateKey,
      ),
      {},
      bundle.config,
    );
    expect(finished.status).toBe("succeeded");
    const closed = await adapter.verifyWebhook(
      alipayNotifyBody(
        { ...base, notify_id: "n_cl", trade_status: "TRADE_CLOSED" },
        bundle.platform.privateKey,
      ),
      {},
      bundle.config,
    );
    expect(closed.status).toBe("failed");
  });

  it("rejects a bad RSA2 notify signature before trusting fields", async () => {
    const adapter = new AlipayF2fPaymentAdapter(undefined, clock);
    const body = alipayNotifyBody(
      {
        app_id: "2021000000000001",
        notify_id: "n_bad",
        out_trade_no: "att_1",
        passback_params: "ord_1",
        seller_id: "2088000000000001",
        total_amount: "12.00",
        trade_status: "TRADE_SUCCESS",
        trade_no: "2026090722001400000001",
      },
      bundle.platform.privateKey,
    );
    const tampered = Buffer.from(`${body.toString("utf8")}&evil=1`);
    await expect(adapter.verifyWebhook(tampered, {}, bundle.config)).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });
  });

  it("queries and refunds through official methods", async () => {
    const adapter = new AlipayF2fPaymentAdapter(async (_url, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("alipay.trade.query")) {
        return textResponse(
          signedGatewayJson(
            "alipay.trade.query",
            {
              code: "10000",
              trade_status: "TRADE_SUCCESS",
              total_amount: "12.00",
              out_trade_no: "att_1",
              trade_no: "2026090722001400000001",
              seller_id: "2088000000000001",
            },
            bundle.platform.privateKey,
          ),
        );
      }
      return textResponse(
        signedGatewayJson(
          "alipay.trade.refund",
          { code: "10000", trade_no: "2026090722001400000001", fund_change: "Y" },
          bundle.platform.privateKey,
        ),
      );
    }, clock);
    const query = await adapter.queryPayment("att_1", bundle.config);
    expect(query.status).toBe("succeeded");
    expect(query.amountCents).toBe(1200);
    const refund = await adapter.refund(
      {
        orderId: "ord_1",
        attemptId: "att_1",
        providerRef: "2026090722001400000001",
        amountCents: 1200,
        currency: "CNY",
        idempotencyKey: "rf_1",
      },
      bundle.config,
    );
    expect(refund.status).toBe("succeeded");
  });

  it("health-checks key pairing and URLs without leaking PEMs; remote is optional", async () => {
    const adapter = new AlipayF2fPaymentAdapter(async () => {
      throw new Error("network should not run on default health");
    }, clock);
    const health = await adapter.healthCheck(bundle.config);
    expect(health.ok).toBe(true);
    expect(JSON.stringify(health)).not.toContain("BEGIN");
    expect(health.diagnostics?.merchantApproved).toBe(false);
    const dumped = JSON.stringify(bundle.config.credentials.merchantPrivateKey);
    expect(JSON.stringify(health)).not.toContain(dumped.slice(20, 40));
  });

  it("times out official HTTPS calls", async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
      throw new Error("unreachable");
    };
    await expect(
      paymentFetch(
        fetchImpl,
        "https://openapi.alipay.com/gateway.do",
        { method: "POST" },
        {
          allowedHosts: new Set(["openapi.alipay.com"]),
          timeoutMs: 20,
        },
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_UNAVAILABLE" });
    expect(PAYMENT_HTTP_TIMEOUT_MS).toBeGreaterThan(1000);
  });

  it("lets core treat a duplicate notify_id as already handled", async () => {
    const adapter = new AlipayF2fPaymentAdapter(undefined, clock);
    const duplicate = Object.assign(new QueryFailedError("insert", [], new Error("dup")), {
      driverError: { code: "23505" },
    });
    const webhook = new PaymentWebhookService(
      { transaction: jest.fn() } as never,
      {
        create: jest.fn((row: unknown) => row),
        save: jest.fn().mockRejectedValue(duplicate),
        update: jest.fn(),
      } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      {
        loadEnabled: jest.fn().mockResolvedValue({
          id: "cfg-alipay",
          providerId: "alipay_f2f",
          enabled: true,
          status: "active",
        }),
        adapterFor: () => adapter,
        decryptCurrentAndPrevious: () => [bundle.config],
      } as never,
      { rawBodySha256: () => "h" } as never,
      { record: jest.fn() } as never,
    );
    const body = alipayNotifyBody(
      {
        app_id: "2021000000000001",
        notify_id: "n_dup",
        out_trade_no: "att_1",
        passback_params: "ord_1",
        seller_id: "2088000000000001",
        total_amount: "12.00",
        trade_status: "TRADE_SUCCESS",
        trade_no: "2026090722001400000001",
      },
      bundle.platform.privateKey,
    );
    const ack = await webhook.handlePublic({
      provider: "alipay_f2f",
      configId: "cfg-alipay",
      rawBody: body,
      headers: {},
    });
    expect(ack.body).toBe("success");
  });
});
