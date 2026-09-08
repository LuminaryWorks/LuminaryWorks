import { EntitlementException } from "../src/common/errors";
import { UnionpayQuickpassPaymentAdapter } from "../src/modules/payments/unionpay-quickpass.adapter";
import {
  canonicalUnionPayParams,
  signUnionPayParams,
  verifyUnionPayParams,
} from "../src/modules/payments/unionpay-protocol";
import { makeUnionpayBundle, textResponse } from "./payment-adapter-fixtures";

const fixedNow = new Date("2026-09-07T12:00:00Z");
const clock = { now: () => fixedNow };

function signedUnionpay(
  params: Record<string, string>,
  privateKeyPem: string,
): Record<string, string> {
  return { ...params, signature: signUnionPayParams(params, privateKeyPem) };
}

function formBody(params: Record<string, string>): Buffer {
  return Buffer.from(new URLSearchParams(params).toString());
}

describe("unionpay_quickpass adapter", () => {
  const bundle = makeUnionpayBundle();

  it("canonicalizes TreeMap-style parameters and signs with RSA-SHA256", () => {
    const params = { merId: "777290058110097", txnAmt: "1200", version: "5.1.0", signature: "x" };
    const canonical = canonicalUnionPayParams(params);
    expect(canonical).toBe("merId=777290058110097&txnAmt=1200&version=5.1.0");
    const signed = signedUnionpay(
      { merId: "777290058110097", txnAmt: "1200" },
      bundle.merchant.privateKey,
    );
    expect(verifyUnionPayParams(signed, bundle.merchant.publicKey)).toBe(true);
  });

  it("returns an official hosted form_post without marking paid", async () => {
    const adapter = new UnionpayQuickpassPaymentAdapter(async () => {
      throw new Error("hosted checkout must not call the gateway");
    }, clock);
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "attunpay1",
      amountCents: 1200,
      currency: "CNY",
      config: bundle.config,
    });
    expect(session.status).toBe("pending");
    expect(session.checkoutUrl).toContain("gateway.test.95516.com");
    expect(session.action).toMatchObject({ type: "form_post" });
    const fields = session.action?.fields as Record<string, string>;
    expect(fields.txnAmt).toBe("1200");
    expect(fields.currencyCode).toBe("156");
    expect(fields.orderId).toBe("attunpay1");
    expect(fields.reqReserved).toBe("ord_1");
    expect(verifyUnionPayParams(fields, bundle.merchant.publicKey)).toBe(true);
  });

  it("creates QR through backTransReq when checkoutMode=qr", async () => {
    const qrConfig = {
      ...bundle.config,
      credentials: { ...bundle.config.credentials, checkoutMode: "qr" },
    };
    const adapter = new UnionpayQuickpassPaymentAdapter(async (url) => {
      expect(String(url)).toContain("backTransReq.do");
      const signed = signedUnionpay(
        {
          respCode: "00",
          respMsg: "success",
          qrCode: "https://qr.95516.com/00010000/fixture",
          merId: "777290058110097",
          orderId: "attunpay1",
          queryId: "202609071200001234567",
        },
        bundle.platform.privateKey,
      );
      return textResponse(new URLSearchParams(signed).toString());
    }, clock);
    const session = await adapter.createCheckout({
      orderId: "ord_1",
      attemptId: "attunpay1",
      amountCents: 1200,
      currency: "CNY",
      config: qrConfig,
    });
    expect(session.qrPayload).toContain("95516.com");
  });

  it("treats backUrl as paid only after signature plus query/respCode", async () => {
    const adapter = new UnionpayQuickpassPaymentAdapter(async (url) => {
      expect(String(url)).toContain("queryTrans.do");
      const signed = signedUnionpay(
        {
          respCode: "00",
          origRespCode: "00",
          merId: "777290058110097",
          orderId: "attunpay1",
          txnAmt: "1200",
          queryId: "202609071200001234567",
          reqReserved: "ord_1",
        },
        bundle.platform.privateKey,
      );
      return textResponse(new URLSearchParams(signed).toString());
    }, clock);
    const notify = signedUnionpay(
      {
        respCode: "00",
        merId: "777290058110097",
        orderId: "attunpay1",
        txnTime: "20260907200000",
        txnAmt: "1200",
        currencyCode: "156",
        queryId: "202609071200001234567",
        reqReserved: "ord_1",
        traceNo: "tr_1",
      },
      bundle.platform.privateKey,
    );
    const verified = await adapter.verifyWebhook(formBody(notify), {}, bundle.config);
    expect(verified.status).toBe("succeeded");
    expect(verified.ack?.body).toBe("ok");
  });

  it("rejects a bad backUrl signature and wrong merId", async () => {
    const adapter = new UnionpayQuickpassPaymentAdapter(undefined, clock);
    const notify = signedUnionpay(
      {
        respCode: "00",
        merId: "777290058110097",
        orderId: "attunpay1",
        txnAmt: "1200",
        currencyCode: "156",
        queryId: "1",
        traceNo: "tr_bad",
      },
      bundle.platform.privateKey,
    );
    notify.txnAmt = "9999";
    await expect(adapter.verifyWebhook(formBody(notify), {}, bundle.config)).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_INVALID",
    });
    const wrongMer = signedUnionpay(
      {
        respCode: "03",
        merId: "111111111111111",
        orderId: "attunpay1",
        txnAmt: "1200",
        currencyCode: "156",
        traceNo: "tr_mer",
      },
      bundle.platform.privateKey,
    );
    await expect(
      adapter.verifyWebhook(formBody(wrongMer), {}, bundle.config),
    ).rejects.toMatchObject({
      code: "PAYMENT_AMOUNT_MISMATCH",
    });
  });

  it("does not mark paid from a front-channel complete while query is unpaid", async () => {
    const adapter = new UnionpayQuickpassPaymentAdapter(async () => {
      const signed = signedUnionpay(
        {
          respCode: "00",
          origRespCode: "03",
          merId: "777290058110097",
          orderId: "attunpay1",
          txnAmt: "1200",
        },
        bundle.platform.privateKey,
      );
      return textResponse(new URLSearchParams(signed).toString());
    }, clock);
    const result = await adapter.completeCheckout({
      orderId: "ord_1",
      attemptId: "attunpay1",
      providerRef: "attunpay1|20260907200000",
      amountCents: 1200,
      currency: "CNY",
      config: bundle.config,
    });
    expect(result.status).toBe("pending");
  });

  it("refunds through backTransReq using origQryId", async () => {
    const adapter = new UnionpayQuickpassPaymentAdapter(async (url) => {
      if (String(url).includes("queryTrans.do")) {
        const signed = signedUnionpay(
          {
            respCode: "00",
            origRespCode: "00",
            merId: "777290058110097",
            orderId: "attunpay1",
            txnAmt: "1200",
            queryId: "202609071200001234567",
          },
          bundle.platform.privateKey,
        );
        return textResponse(new URLSearchParams(signed).toString());
      }
      const signed = signedUnionpay(
        { respCode: "00", queryId: "202609071200009999999", merId: "777290058110097" },
        bundle.platform.privateKey,
      );
      return textResponse(new URLSearchParams(signed).toString());
    }, clock);
    const refund = await adapter.refund(
      {
        orderId: "ord_1",
        attemptId: "attunpay1",
        providerRef: "202609071200001234567",
        amountCents: 1200,
        currency: "CNY",
        idempotencyKey: "refund01",
      },
      bundle.config,
    );
    expect(refund.status).toBe("succeeded");
  });

  it("fails health rather than faking SM2 or unknown checkout modes", async () => {
    const adapter = new UnionpayQuickpassPaymentAdapter(undefined, clock);
    const sm2 = await adapter.healthCheck({
      ...bundle.config,
      credentials: { ...bundle.config.credentials, signMethod: "11" },
    });
    expect(sm2.ok).toBe(false);
    const jsapi = await adapter.healthCheck({
      ...bundle.config,
      credentials: { ...bundle.config.credentials, checkoutMode: "jsapi" },
    });
    expect(jsapi.ok).toBe(false);
    const health = await adapter.healthCheck(bundle.config);
    expect(health.ok).toBe(true);
    expect(JSON.stringify(health)).not.toContain("BEGIN");
  });

  it("times out official HTTPS calls", async () => {
    const qrConfig = {
      ...bundle.config,
      credentials: { ...bundle.config.credentials, checkoutMode: "qr" },
    };
    const adapter = new UnionpayQuickpassPaymentAdapter(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }, clock);
    await expect(
      adapter.createCheckout({
        orderId: "ord_1",
        attemptId: "attunpay1",
        amountCents: 1200,
        currency: "CNY",
        config: qrConfig,
      }),
    ).rejects.toBeInstanceOf(EntitlementException);
  });
});
