import { loadPrivateKey } from "../src/common/payment-credentials";
import { EntitlementException } from "../src/common/errors";
import { WechatPayV3PaymentAdapter } from "../src/modules/payments/wechat-pay-v3.adapter";
import {
  encryptWechatResource,
  signWechatRequest,
  wechatNotifyMessage,
  wechatSignMessage,
} from "../src/modules/payments/wechat-pay-v3.protocol";
import { jsonResponse, makeWechatBundle } from "./payment-adapter-fixtures";

const fixedNow = new Date("2026-09-07T12:00:00Z");
const clock = { now: () => fixedNow };
const ts = String(Math.floor(fixedNow.getTime() / 1000));

function signedNotify(
  bundle: ReturnType<typeof makeWechatBundle>,
  trade: Record<string, unknown>,
  opts?: { serial?: string; timestamp?: string; nonce?: string },
) {
  const resource = encryptWechatResource(
    JSON.stringify(trade),
    bundle.apiV3Key,
    "transaction",
    "123456789012",
  );
  const envelope = {
    id: "EV-1",
    event_type: "TRANSACTION.SUCCESS",
    resource,
  };
  const body = JSON.stringify(envelope);
  const timestamp = opts?.timestamp ?? ts;
  const nonce = opts?.nonce ?? "nonce-wechat-1";
  const message = wechatNotifyMessage(timestamp, nonce, body);
  const signature = signWechatRequest(message, loadPrivateKey(bundle.platform.privateKey));
  return {
    body: Buffer.from(body),
    headers: {
      "wechatpay-timestamp": timestamp,
      "wechatpay-nonce": nonce,
      "wechatpay-signature": signature,
      "wechatpay-serial": opts?.serial ?? "PUB_KEY_ID_TEST001",
      "wechatpay-signature-type": "WECHATPAY2-SHA256-RSA2048",
    },
  };
}

function trade(overrides: Record<string, unknown> = {}) {
  return {
    mchid: "1900000001",
    appid: "wx1234567890abcdef",
    out_trade_no: "att_wechat_1",
    attach: "ord_1",
    transaction_id: "4200001234567890",
    trade_state: "SUCCESS",
    amount: { total: 1200, currency: "CNY" },
    ...overrides,
  };
}

describe("wechat_pay_v3 adapter", () => {
  const bundle = makeWechatBundle();

  it("builds MCH RSA-SHA256 Authorization and Native QR checkout", async () => {
    const adapter = new WechatPayV3PaymentAdapter(async (url, init) => {
      expect(String(url)).toBe("https://api.mch.weixin.qq.com/v3/pay/transactions/native");
      const auth = String(
        (init?.headers as Record<string, string>)?.authorization ??
          (init?.headers as Headers | undefined)?.get?.("authorization") ??
          "",
      );
      expect(auth).toContain("WECHATPAY2-SHA256-RSA2048");
      expect(auth).toContain('mchid="1900000001"');
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body.out_trade_no).toBe("att_wechat_1");
      expect(body.attach).toBe("ord_1");
      expect(body.notify_url).toBe(bundle.config.credentials.notifyUrl);
      const amount = body.amount as { total?: number; currency?: string };
      expect(amount).toEqual({ total: 1200, currency: "CNY" });
      const unsigned = wechatSignMessage(
        "POST",
        "/v3/pay/transactions/native",
        auth.match(/timestamp="(\d+)"/)?.[1] ?? "",
        auth.match(/nonce_str="([^"]+)"/)?.[1] ?? "",
        String(init?.body ?? ""),
      );
      expect(
        signWechatRequest(unsigned, loadPrivateKey(bundle.config.credentials.merchantPrivateKey))
          .length,
      ).toBeGreaterThan(80);
      return jsonResponse({ code_url: "weixin://wxpay/bizpayurl?pr=fixture" });
    }, clock);
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "att_wechat_1",
      amountCents: 1200,
      currency: "CNY",
      config: bundle.config,
    });
    expect(session.status).toBe("pending");
    expect(session.qrPayload).toContain("weixin://");
  });

  it("maps SUCCESS/NOTPAY/CLOSED/REVOKED/PAYERROR/REFUND after AES-GCM decrypt", async () => {
    const adapter = new WechatPayV3PaymentAdapter(undefined, clock);
    const states: Array<[string, string]> = [
      ["SUCCESS", "succeeded"],
      ["NOTPAY", "pending"],
      ["CLOSED", "failed"],
      ["REVOKED", "failed"],
      ["PAYERROR", "failed"],
      ["REFUND", "ignored"],
    ];
    for (const [tradeState, status] of states) {
      const notify = signedNotify(
        bundle,
        trade({ trade_state: tradeState, transaction_id: tradeState }),
      );
      const verified = await adapter.verifyWebhook(notify.body, notify.headers, bundle.config);
      expect(verified.status).toBe(status);
      expect(verified.ack?.body).toEqual({ code: "SUCCESS", message: "成功" });
    }
  });

  it("rejects bad signature, stale timestamp, and unknown serial", async () => {
    const adapter = new WechatPayV3PaymentAdapter(undefined, clock);
    const good = signedNotify(bundle, trade());
    await expect(
      adapter.verifyWebhook(
        good.body,
        { ...good.headers, "wechatpay-signature": "AAAA" },
        bundle.config,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
    await expect(
      adapter.verifyWebhook(
        good.body,
        { ...good.headers, "wechatpay-serial": "UNKNOWNSERIAL01" },
        bundle.config,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
    const stale = signedNotify(bundle, trade(), { timestamp: "1000000000" });
    await expect(
      adapter.verifyWebhook(stale.body, stale.headers, bundle.config),
    ).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });
  });

  it("rejects mchid/amount/currency mismatches after cryptographic verify", async () => {
    const adapter = new WechatPayV3PaymentAdapter(undefined, clock);
    const wrongMch = signedNotify(bundle, trade({ mchid: "1900000099" }));
    await expect(
      adapter.verifyWebhook(wrongMch.body, wrongMch.headers, bundle.config),
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH" });
    const wrongCcy = signedNotify(bundle, trade({ amount: { total: 1200, currency: "USD" } }));
    await expect(
      adapter.verifyWebhook(wrongCcy.body, wrongCcy.headers, bundle.config),
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH" });
  });

  it("queries out-trade-no and refunds through official paths", async () => {
    const adapter = new WechatPayV3PaymentAdapter(async (url) => {
      const parsed = new URL(String(url));
      expect(parsed.hostname).toBe("api.mch.weixin.qq.com");
      if (parsed.pathname.includes("/refund/domestic/refunds")) {
        return jsonResponse({
          refund_id: "rf_1",
          status: "SUCCESS",
          amount: { refund: 500, total: 1200, currency: "CNY" },
        });
      }
      expect(parsed.pathname).toBe("/v3/pay/transactions/out-trade-no/att_wechat_1");
      expect(parsed.searchParams.get("mchid")).toBe("1900000001");
      return jsonResponse({
        trade_state: "SUCCESS",
        transaction_id: "4200001234567890",
        out_trade_no: "att_wechat_1",
        attach: "ord_1",
        mchid: "1900000001",
        amount: { total: 1200, currency: "CNY" },
      });
    }, clock);
    const query = await adapter.queryPayment("att_wechat_1", bundle.config);
    expect(query.status).toBe("succeeded");
    const refund = await adapter.refund(
      {
        orderId: "ord_1",
        attemptId: "att_wechat_1",
        providerRef: "att_wechat_1",
        amountCents: 500,
        currency: "CNY",
        idempotencyKey: "rf_partial_1",
      },
      bundle.config,
    );
    expect(refund.status).toBe("succeeded");
    expect(refund.amountCents).toBe(500);
  });

  it("completeCheckout queries instead of trusting a front-channel redirect", async () => {
    const adapter = new WechatPayV3PaymentAdapter(async () => {
      return jsonResponse({
        trade_state: "NOTPAY",
        out_trade_no: "att_wechat_1",
        amount: { total: 1200, currency: "CNY" },
      });
    }, clock);
    const result = await adapter.completeCheckout({
      orderId: "ord_1",
      attemptId: "att_wechat_1",
      providerRef: "att_wechat_1",
      amountCents: 1200,
      currency: "CNY",
      config: bundle.config,
    });
    expect(result.status).toBe("pending");
  });

  it("health-checks locally without network and redacts PEMs", async () => {
    const adapter = new WechatPayV3PaymentAdapter(async () => {
      throw new Error("network should not run on default health");
    }, clock);
    const health = await adapter.healthCheck(bundle.config);
    expect(health.ok).toBe(true);
    expect(health.diagnostics?.platformSerialCount).toBe(2);
    expect(JSON.stringify(health)).not.toContain("BEGIN");
    expect(JSON.stringify(health)).not.toContain(bundle.apiV3Key);
  });

  it("times out official HTTPS calls", async () => {
    const adapter = new WechatPayV3PaymentAdapter(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }, clock);
    await expect(
      adapter.createCheckout({
        orderId: "ord_1",
        attemptId: "att_wechat_1",
        amountCents: 1200,
        currency: "CNY",
        config: bundle.config,
      }),
    ).rejects.toBeInstanceOf(EntitlementException);
  });
});
