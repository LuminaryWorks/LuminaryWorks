import dataSource from "../src/database/data-source";
import { hmacSha256Hex } from "../src/common/crypto";
import { encryptPaymentSecrets } from "../src/common/payment-crypto";
import {
  OrderEntity,
  PaymentAttemptEntity,
  PaymentProviderConfigEntity,
  ProviderWebhookEventEntity,
} from "../src/database/entities";
import { MockPaymentAdapter, MOCK_SIGNATURE_HEADER } from "../src/modules/payments/adapters";
import { AlipayF2fPaymentAdapter } from "../src/modules/payments/alipay-f2f.adapter";
import { CoinbaseCommercePaymentAdapter } from "../src/modules/payments/coinbase-commerce.adapter";
import { BitpayPaymentAdapter } from "../src/modules/payments/bitpay.adapter";
import { OkxOnchainPaymentAdapter } from "../src/modules/payments/okx-onchain.adapter";
import { StripeCheckoutPaymentAdapter } from "../src/modules/payments/stripe-checkout.adapter";
import { UnionpayQuickpassPaymentAdapter } from "../src/modules/payments/unionpay-quickpass.adapter";
import { WechatPayV3PaymentAdapter } from "../src/modules/payments/wechat-pay-v3.adapter";
import {
  alipayNotifyBody,
  coinbaseConfig,
  jsonResponse,
  makeAlipayBundle,
  makeUnionpayBundle,
  makeWechatBundle,
  stripeConfig,
} from "./payment-adapter-fixtures";
import { loadPrivateKey } from "../src/common/payment-credentials";
import {
  encryptWechatResource,
  signWechatRequest,
  wechatNotifyMessage,
} from "../src/modules/payments/wechat-pay-v3.protocol";
import { signUnionPayParams } from "../src/modules/payments/unionpay-protocol";
import Stripe from "stripe";
import { PaymentWebhookService } from "../src/modules/payments/payment-webhook.service";
import type { ProviderConfig } from "../src/modules/payments/payment-adapter";
import { defaultCapabilities } from "../src/common/payment-providers";

const describeDatabase = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const MASTER = Buffer.from("b".repeat(32));

describeDatabase("payment platform database integration", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const mock = new MockPaymentAdapter();
  let configId = "";
  let orderId = "";

  const providerConfig = (): ProviderConfig => ({
    id: configId,
    providerId: "mock",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["GLOBAL"],
    currencies: ["USD"],
    priority: 10,
    capabilities: defaultCapabilities("mock"),
    merchantId: "m_1",
    credentials: { webhookSecret: "whsec_int" },
    metadata: {},
  });

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const configs = dataSource.getRepository(PaymentProviderConfigEntity);
    const saved = await configs.save(
      configs.create({
        providerId: "mock",
        environment: "sandbox",
        enabled: true,
        status: "active",
        marketScopes: ["GLOBAL"],
        currencies: ["USD"],
        priority: 10,
        capabilities: defaultCapabilities("mock"),
        merchantId: "m_1",
        credentialsCiphertext: encryptPaymentSecrets(
          JSON.stringify({ webhookSecret: "whsec_int" }),
          MASTER,
        ),
        credentialFingerprint: "fp",
        credentialLastFour: "hint",
        keyFingerprint: "kid",
        metadata: {},
      }),
    );
    configId = saved.id;
    const orders = dataSource.getRepository(OrderEntity);
    const order = await orders.save(
      orders.create({
        subjectKind: "USER",
        subjectId: `user-${suffix}`,
        productCode: "dataluminary",
        planCode: "pro",
        status: "created",
        amountCents: 1200,
        currency: "USD",
        paymentProvider: "mock",
        paymentConfigId: configId,
        metadata: { kind: "quota_pack", packSku: "unknown-skip" },
      }),
    );
    orderId = order.id;
  });

  afterAll(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  it("stores ciphertext and never leaves plaintext credentials in the config row", async () => {
    const row = await dataSource.getRepository(PaymentProviderConfigEntity).findOneByOrFail({
      id: configId,
    });
    expect(row.credentialsCiphertext.startsWith("lwpay1.")).toBe(true);
    expect(JSON.stringify(row)).not.toContain("whsec_int");
  });

  it("rejects a second identical webhook event", async () => {
    const attempts = dataSource.getRepository(PaymentAttemptEntity);
    const attempt = await attempts.save(
      attempts.create({
        orderId,
        configId,
        provider: "mock",
        providerRef: `mock_${suffix}`,
        status: "pending",
        amountCents: 1200,
        currency: "USD",
        merchantId: "m_1",
        metadata: {},
      }),
    );
    const events = dataSource.getRepository(ProviderWebhookEventEntity);
    const body = JSON.stringify({
      eventId: `evt-${suffix}`,
      orderId,
      attemptId: attempt.id,
      providerRef: attempt.providerRef,
      amountCents: 1200,
      currency: "USD",
      merchantId: "m_1",
      status: "succeeded",
    });
    const paymentConfigs = {
      loadEnabled: async () =>
        dataSource.getRepository(PaymentProviderConfigEntity).findOneBy({ id: configId }),
      adapterFor: () => mock,
      decryptCurrentAndPrevious: () => [providerConfig()],
      decryptForAdapter: () => providerConfig(),
    };
    const webhook = new PaymentWebhookService(
      dataSource,
      events,
      attempts,
      dataSource.getRepository(OrderEntity),
      paymentConfigs as never,
      {
        rawBodySha256: (raw: Uint8Array) => Buffer.from(raw).toString("hex").slice(0, 64),
        assertSnapshotMatch: () => {
          throw new Error("should not fulfill unknown pack in this assertion path");
        },
      } as never,
      { record: jest.fn() } as never,
    );
    const headers = { [MOCK_SIGNATURE_HEADER]: hmacSha256Hex("whsec_int", body) };
    await events.insert({
      provider: "mock",
      configId,
      eventId: `evt-${suffix}`,
      rawBodySha256: "abc",
      payload: {},
      status: "processed",
    });
    const ack = await webhook.handlePublic({
      provider: "mock",
      configId,
      rawBody: Buffer.from(body),
      headers,
    });
    expect(ack.body).toEqual({ received: true });
    const count = await events.count({ where: { eventId: `evt-${suffix}` } });
    expect(count).toBe(1);
  });

  it("accepts a signed Alipay notify once through the public webhook core", async () => {
    const bundle = makeAlipayBundle();
    const adapter = new AlipayF2fPaymentAdapter();
    const orders = dataSource.getRepository(OrderEntity);
    const order = await orders.save(
      orders.create({
        subjectKind: "USER",
        subjectId: `user-alipay-${suffix}`,
        productCode: "dataluminary",
        planCode: "pro",
        status: "pending_payment",
        amountCents: 1200,
        currency: "CNY",
        paymentProvider: "alipay_f2f",
        paymentConfigId: configId,
        metadata: { kind: "quota_pack", packSku: "unknown-skip" },
      }),
    );
    const attempts = dataSource.getRepository(PaymentAttemptEntity);
    const attempt = await attempts.save(
      attempts.create({
        orderId: order.id,
        configId,
        provider: "alipay_f2f",
        providerRef: attemptIdFor(order.id),
        status: "pending",
        amountCents: 1200,
        currency: "CNY",
        merchantId: bundle.config.merchantId,
        metadata: {},
      }),
    );
    const body = alipayNotifyBody(
      {
        app_id: bundle.config.credentials.appId,
        notify_id: `n-${suffix}`,
        out_trade_no: attempt.id,
        passback_params: order.id,
        seller_id: bundle.config.credentials.sellerId ?? "",
        total_amount: "12.00",
        trade_status: "WAIT_BUYER_PAY",
        trade_no: "2026090722001400000099",
      },
      bundle.platform.privateKey,
    );
    const events = dataSource.getRepository(ProviderWebhookEventEntity);
    const webhook = new PaymentWebhookService(
      dataSource,
      events,
      attempts,
      orders,
      {
        loadEnabled: async () => ({
          id: configId,
          providerId: "alipay_f2f",
          enabled: true,
          status: "active",
        }),
        adapterFor: () => adapter,
        decryptCurrentAndPrevious: () => [
          { ...bundle.config, id: configId, providerId: "alipay_f2f" },
        ],
        decryptForAdapter: () => bundle.config,
      } as never,
      {
        rawBodySha256: (raw: Uint8Array) => Buffer.from(raw).toString("hex").slice(0, 64),
        assertSnapshotMatch: () => undefined,
      } as never,
      { record: jest.fn() } as never,
    );
    const first = await webhook.handlePublic({
      provider: "alipay_f2f",
      configId,
      rawBody: body,
      headers: {},
    });
    expect(first.body).toBe("success");
    const second = await webhook.handlePublic({
      provider: "alipay_f2f",
      configId,
      rawBody: body,
      headers: {},
    });
    expect(second.body).toBe("success");
    const count = await events.count({ where: { eventId: `n-${suffix}` } });
    expect(count).toBe(1);
  });

  it("accepts WeChat / UnionPay / Stripe public webhooks once through core", async () => {
    const wechat = makeWechatBundle();
    const unionpay = makeUnionpayBundle();
    const stripe = stripeConfig();
    const now = new Date("2026-09-07T12:00:00Z");
    const ts = String(Math.floor(now.getTime() / 1000));

    const wxResource = encryptWechatResource(
      JSON.stringify({
        mchid: wechat.config.credentials.mchid,
        appid: wechat.config.credentials.appid,
        out_trade_no: orderId.replaceAll("-", ""),
        attach: orderId,
        transaction_id: "4200009999",
        trade_state: "NOTPAY",
        amount: { total: 1200, currency: "CNY" },
      }),
      wechat.apiV3Key,
      "transaction",
      "123456789012",
    );
    const wxBody = JSON.stringify({
      id: `wx-${suffix}`,
      event_type: "TRANSACTION.SUCCESS",
      resource: wxResource,
    });
    const wxSig = signWechatRequest(
      wechatNotifyMessage(ts, "n1", wxBody),
      loadPrivateKey(wechat.platform.privateKey),
    );
    await expectDuplicatePublicWebhook({
      provider: "wechat_pay_v3",
      adapter: new WechatPayV3PaymentAdapter(undefined, { now: () => now }),
      config: { ...wechat.config, id: configId },
      eventId: `wx-${suffix}`,
      rawBody: Buffer.from(wxBody),
      headers: {
        "wechatpay-timestamp": ts,
        "wechatpay-nonce": "n1",
        "wechatpay-signature": wxSig,
        "wechatpay-serial": "PUB_KEY_ID_TEST001",
      },
      ackBody: { code: "SUCCESS", message: "成功" },
    });

    const unionNotify: Record<string, string> = {
      respCode: "03",
      merId: unionpay.config.credentials.merId,
      orderId: orderId.replaceAll("-", "").slice(0, 32),
      txnTime: "20260907200000",
      txnAmt: "1200",
      currencyCode: "156",
      queryId: "202609071200001234567",
      reqReserved: orderId,
      traceNo: `up-${suffix}`,
    };
    unionNotify.signature = signUnionPayParams(unionNotify, unionpay.platform.privateKey);
    await expectDuplicatePublicWebhook({
      provider: "unionpay_quickpass",
      adapter: new UnionpayQuickpassPaymentAdapter(undefined, { now: () => now }),
      config: { ...unionpay.config, id: configId },
      eventId: `up-${suffix}`,
      rawBody: Buffer.from(new URLSearchParams(unionNotify).toString()),
      headers: {},
      ackBody: "ok",
    });

    const payload = JSON.stringify({
      id: `st-${suffix}`,
      object: "event",
      type: "checkout.session.completed",
      api_version: "2026-08-26",
      data: {
        object: {
          id: "cs_test_int",
          object: "checkout.session",
          payment_status: "unpaid",
          amount_total: 1200,
          currency: "usd",
          client_reference_id: orderId,
          metadata: { orderId, attemptId: orderId },
        },
      },
    });
    await expectDuplicatePublicWebhook({
      provider: "stripe_checkout",
      adapter: new StripeCheckoutPaymentAdapter(undefined, { now: () => now }),
      config: { ...stripe, id: configId },
      eventId: `st-${suffix}`,
      rawBody: Buffer.from(payload),
      headers: {
        "stripe-signature": Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: stripe.credentials.webhookSecret,
          timestamp: Number(ts),
        }),
      },
      ackBody: { received: true },
    });

    const { hmacSha256Hex } = await import("../src/common/crypto");
    const cb = coinbaseConfig();
    const cbBody = JSON.stringify({
      id: "68f7a946db0529ea9b6d3a12",
      eventType: "checkout.payment.success",
      status: "ACTIVE",
      amount: "12.00",
      currency: "USDC",
      network: "base",
      metadata: { orderId, attemptId: orderId },
    });
    const headerNames = "content-type x-event-id x-event-type";
    const extra = {
      "content-type": "application/json",
      "x-event-id": `cb-${suffix}`,
      "x-event-type": "checkout.payment.success",
    };
    const values = headerNames
      .split(" ")
      .map((name) => extra[name as keyof typeof extra])
      .join(".");
    const v1 = hmacSha256Hex(
      cb.credentials.webhookSecret,
      `${ts}.${headerNames}.${values}.${cbBody}`,
    );
    await expectDuplicatePublicWebhook({
      provider: "coinbase_commerce",
      adapter: new CoinbaseCommercePaymentAdapter(undefined, { now: () => now }, async () => "jwt"),
      config: { ...cb, id: configId },
      eventId: `cb-${suffix}`,
      rawBody: Buffer.from(cbBody),
      headers: { ...extra, "x-hook0-signature": `t=${ts},h=${headerNames},v1=${v1}` },
      ackBody: { received: true },
    });

    const bitpayInvoiceId = `Hpqc${suffix.replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}`;
    const bpBody = JSON.stringify({
      event: { code: 1004, name: "invoice_paid" },
      data: { id: bitpayInvoiceId, status: "paid", orderId },
    });
    await expectDuplicatePublicWebhook({
      provider: "bitpay",
      adapter: new BitpayPaymentAdapter(async () =>
        jsonResponse({
          data: {
            id: bitpayInvoiceId,
            status: "paid",
            price: 12,
            currency: "USD",
            orderId,
          },
        }),
      ),
      config: {
        id: configId,
        providerId: "bitpay",
        environment: "sandbox",
        enabled: true,
        status: "active",
        marketScopes: ["GLOBAL"],
        currencies: ["USD"],
        priority: 1,
        capabilities: defaultCapabilities("bitpay"),
        merchantId: "m",
        credentials: {
          posToken: "A".repeat(44),
          notificationUrl: "https://entitlement.example.com/v1/payments/webhooks/bitpay/cfg",
        },
        metadata: {},
      },
      eventId: `${bitpayInvoiceId}:paid:1004`,
      rawBody: Buffer.from(bpBody),
      headers: {},
      ackBody: "Success",
    });

    const okx = new OkxOnchainPaymentAdapter();
    await expect(
      okx.verifyWebhook(
        Buffer.from("{}"),
        {},
        {
          id: configId,
          providerId: "okx_onchain",
          environment: "sandbox",
          enabled: true,
          status: "active",
          marketScopes: ["GLOBAL"],
          currencies: ["USD"],
          priority: 1,
          capabilities: defaultCapabilities("okx_onchain"),
          merchantId: null,
          credentials: {
            apiKey: "okx-api-key-fixture",
            secretKey: "okx-secret-key-fixture",
            passphrase: "okx-pass",
            payTo: "0x1111111111111111111111111111111111111111",
            network: "eip155:196",
          },
          metadata: {},
        },
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
  });
});

function attemptIdFor(orderId: string): string {
  return `att_${orderId.slice(0, 8)}`;
}

async function expectDuplicatePublicWebhook(input: {
  provider: string;
  adapter:
    | WechatPayV3PaymentAdapter
    | UnionpayQuickpassPaymentAdapter
    | StripeCheckoutPaymentAdapter
    | CoinbaseCommercePaymentAdapter
    | BitpayPaymentAdapter;
  config: ProviderConfig;
  eventId: string;
  rawBody: Buffer;
  headers: Record<string, string>;
  ackBody: unknown;
}): Promise<void> {
  const events = dataSource.getRepository(ProviderWebhookEventEntity);
  const webhook = new PaymentWebhookService(
    dataSource,
    events,
    dataSource.getRepository(PaymentAttemptEntity),
    dataSource.getRepository(OrderEntity),
    {
      loadEnabled: async () => ({
        id: input.config.id,
        providerId: input.provider,
        enabled: true,
        status: "active",
      }),
      adapterFor: () => input.adapter,
      decryptCurrentAndPrevious: () => [input.config],
      decryptForAdapter: () => input.config,
    } as never,
    {
      rawBodySha256: (raw: Uint8Array) => Buffer.from(raw).toString("hex").slice(0, 64),
      assertSnapshotMatch: () => undefined,
    } as never,
    { record: jest.fn() } as never,
  );
  const first = await webhook.handlePublic({
    provider: input.provider,
    configId: input.config.id,
    rawBody: input.rawBody,
    headers: input.headers,
  });
  expect(first.body).toEqual(input.ackBody);
  const second = await webhook.handlePublic({
    provider: input.provider,
    configId: input.config.id,
    rawBody: input.rawBody,
    headers: input.headers,
  });
  expect(second.body).toEqual(input.ackBody);
  const count = await events.count({ where: { eventId: input.eventId } });
  expect(count).toBe(1);
}
