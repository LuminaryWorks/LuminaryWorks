import { PaymentWebhookService } from "../src/modules/payments/payment-webhook.service";
import {
  computeDoerflowWebhookSignature,
  deriveChargeEventId,
  MERCHANT_CHARGE_EVENT_TYPE,
  MERCHANT_REFUND_EVENT_TYPE,
  toLedgerAmountMinor,
} from "../src/modules/payments/doerflow-credit";

const CONFIG_ID = "00000000-0000-4000-8000-00000000dfc1";
const MERCHANT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SECRET = "whsec_doerflow_hmac_fixture";

function signed(payload: Record<string, unknown>, nonce: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from(JSON.stringify(payload));
  return {
    body,
    headers: {
      "x-lw-timestamp": timestamp,
      "x-lw-nonce": nonce,
      "x-lw-signature": `v1=${computeDoerflowWebhookSignature(SECRET, timestamp, nonce, body)}`,
    },
  };
}

function chargePayload(amountMinor = toLedgerAmountMinor(1200)) {
  return {
    eventType: MERCHANT_CHARGE_EVENT_TYPE,
    eventId: deriveChargeEventId("dfc:ord_fx:att_fx"),
    orderId: "ord_fx",
    chargeId: deriveChargeEventId("dfc:ord_fx:att_fx"),
    status: "succeeded",
    amountMinor,
    currency: "USD",
    asset: "USDC",
    merchantAccount: MERCHANT,
    settledAt: new Date().toISOString(),
  };
}

function service() {
  return new PaymentWebhookService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { loadEnabled: async () => null } as never,
    {} as never,
    {} as never,
  );
}

describe("doerflow_credit lab fixture", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.DOERFLOW_CREDIT_FIXTURE;
  const originalSecret = process.env.DOERFLOW_CREDIT_WEBHOOK_SECRET;
  const originalMerchant = process.env.DOERFLOW_MERCHANT_ACCOUNT;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.DOERFLOW_CREDIT_FIXTURE = "1";
    process.env.DOERFLOW_CREDIT_WEBHOOK_SECRET = SECRET;
    process.env.DOERFLOW_MERCHANT_ACCOUNT = MERCHANT;
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalFlag === undefined) delete process.env.DOERFLOW_CREDIT_FIXTURE;
    else process.env.DOERFLOW_CREDIT_FIXTURE = originalFlag;
    if (originalSecret === undefined) delete process.env.DOERFLOW_CREDIT_WEBHOOK_SECRET;
    else process.env.DOERFLOW_CREDIT_WEBHOOK_SECRET = originalSecret;
    if (originalMerchant === undefined) delete process.env.DOERFLOW_MERCHANT_ACCOUNT;
    else process.env.DOERFLOW_MERCHANT_ACCOUNT = originalMerchant;
  });

  it("grants a dry-run plan once and revokes it on refund", async () => {
    const webhooks = service();
    const first = signed(chargePayload(), "nonce_fx_charge_1");
    const granted = await webhooks.handlePublic({
      provider: "doerflow_credit",
      configId: CONFIG_ID,
      rawBody: first.body,
      headers: first.headers,
    });
    expect(granted.body).toMatchObject({
      dryRun: true,
      granted: true,
      revoked: false,
      replayed: false,
      planCode: "pro",
      orderId: "ord_fx",
    });

    const replay = signed(chargePayload(), "nonce_fx_charge_2");
    const again = await webhooks.handlePublic({
      provider: "doerflow_credit",
      configId: CONFIG_ID,
      rawBody: replay.body,
      headers: replay.headers,
    });
    expect(again.body).toMatchObject({ granted: true, replayed: true, revoked: false });
    expect(webhooks.fixtureSnapshot(CONFIG_ID).grants).toHaveLength(1);

    const refundEventId = deriveChargeEventId("refund_fx_1");
    const refund = signed(
      {
        eventType: MERCHANT_REFUND_EVENT_TYPE,
        eventId: refundEventId,
        orderId: "ord_fx",
        chargeId: deriveChargeEventId("dfc:ord_fx:att_fx"),
        status: "succeeded",
        amountMinor: toLedgerAmountMinor(1200),
        currency: "USD",
        asset: "USDC",
        merchantAccount: MERCHANT,
        settledAt: new Date().toISOString(),
      },
      "nonce_fx_refund_1",
    );
    const revoked = await webhooks.handlePublic({
      provider: "doerflow_credit",
      configId: CONFIG_ID,
      rawBody: refund.body,
      headers: refund.headers,
    });
    expect(revoked.body).toMatchObject({ dryRun: true, revoked: true, replayed: false });

    const refundAgain = signed(
      {
        eventType: MERCHANT_REFUND_EVENT_TYPE,
        eventId: refundEventId,
        orderId: "ord_fx",
        chargeId: deriveChargeEventId("dfc:ord_fx:att_fx"),
        status: "succeeded",
        amountMinor: toLedgerAmountMinor(1200),
        currency: "USD",
        asset: "USDC",
        merchantAccount: MERCHANT,
        settledAt: new Date().toISOString(),
      },
      "nonce_fx_refund_2",
    );
    const replayedRefund = await webhooks.handlePublic({
      provider: "doerflow_credit",
      configId: CONFIG_ID,
      rawBody: refundAgain.body,
      headers: refundAgain.headers,
    });
    expect(replayedRefund.body).toMatchObject({ revoked: true, replayed: true });
    expect(webhooks.fixtureSnapshot(CONFIG_ID).grants).toEqual([
      expect.objectContaining({ orderId: "ord_fx", planCode: "pro", revoked: true }),
    ]);
  });

  it("stays closed in production and when the flag is off", async () => {
    const webhooks = service();
    const signedCharge = signed(chargePayload(), "nonce_fx_closed");
    process.env.NODE_ENV = "production";
    process.env.DOERFLOW_CREDIT_FIXTURE = "1";
    await expect(
      webhooks.handlePublic({
        provider: "doerflow_credit",
        configId: CONFIG_ID,
        rawBody: signedCharge.body,
        headers: signedCharge.headers,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(() => webhooks.fixtureSnapshot(CONFIG_ID)).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );

    process.env.NODE_ENV = "test";
    delete process.env.DOERFLOW_CREDIT_FIXTURE;
    await expect(
      webhooks.handlePublic({
        provider: "doerflow_credit",
        configId: CONFIG_ID,
        rawBody: signedCharge.body,
        headers: signedCharge.headers,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
