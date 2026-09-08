import { QueryFailedError } from "typeorm";
import { hmacSha256Hex } from "../src/common/crypto";
import { EntitlementException } from "../src/common/errors";
import { encryptPaymentSecrets, parsePaymentMasterKey } from "../src/common/payment-crypto";
import {
  ContractPaymentAdapter,
  ManualPaymentAdapter,
  MockPaymentAdapter,
  MOCK_SIGNATURE_HEADER,
} from "../src/modules/payments/adapters";
import { BitpayPaymentAdapter } from "../src/modules/payments/bitpay.adapter";
import { BillingProfileService } from "../src/modules/payments/billing-profile.service";
import { CoinbaseCommercePaymentAdapter } from "../src/modules/payments/coinbase-commerce.adapter";
import { OkxOnchainPaymentAdapter } from "../src/modules/payments/okx-onchain.adapter";
import { PaymentWebhookService } from "../src/modules/payments/payment-webhook.service";
import type { ProviderConfig } from "../src/modules/payments/payment-adapter";
import { PaymentsService } from "../src/modules/payments/payments.service";

const MASTER = parsePaymentMasterKey("a".repeat(64));

function mockConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "cfg-mock",
    providerId: "mock",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["GLOBAL"],
    currencies: ["USD"],
    priority: 10,
    capabilities: {
      checkout: true,
      webhook: true,
      query: true,
      refund: true,
      partialRefund: true,
      hostedUrl: true,
      qr: true,
      requiresQueryBeforeFulfill: false,
    },
    merchantId: "m_1",
    credentials: { webhookSecret: "whsec_test" },
    metadata: {},
    ...overrides,
  };
}

function signMock(body: string, secret = "whsec_test"): Record<string, string> {
  return { [MOCK_SIGNATURE_HEADER]: hmacSha256Hex(secret, body) };
}

describe("mock / manual / contract adapters", () => {
  const mock = new MockPaymentAdapter();
  const manual = new ManualPaymentAdapter();
  const contract = new ContractPaymentAdapter();

  it("creates a hosted checkout attempt instead of self-capturing", async () => {
    const session = await mock.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 9900,
      currency: "USD",
      config: mockConfig(),
    });
    expect(session.status).toBe("pending");
    expect(session.checkoutUrl).toContain("att_1");
  });

  it("rejects a forged mock webhook before parsing fulfillment", async () => {
    const body = Buffer.from(
      JSON.stringify({
        eventId: "evt_1",
        orderId: "ord_1",
        attemptId: "att_1",
        amountCents: 9900,
        currency: "USD",
        status: "succeeded",
      }),
    );
    await expect(
      mock.verifyWebhook(body, { [MOCK_SIGNATURE_HEADER]: "deadbeef" }, mockConfig()),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
  });

  it("verifies a signed mock webhook using the raw bytes", async () => {
    const json = JSON.stringify({
      eventId: "evt_1",
      orderId: "ord_1",
      attemptId: "att_1",
      providerRef: "mock_att_1",
      amountCents: 9900,
      currency: "USD",
      merchantId: "m_1",
      status: "succeeded",
    });
    const verified = await mock.verifyWebhook(Buffer.from(json), signMock(json), mockConfig());
    expect(verified.eventId).toBe("evt_1");
    expect(verified.status).toBe("succeeded");
  });

  it("does not let a browser confirm manual or contract payments", async () => {
    await expect(
      manual.verifyWebhook(
        Buffer.from("{}"),
        {},
        mockConfig({ providerId: "manual", credentials: {} }),
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
    await expect(
      contract.verifyWebhook(
        Buffer.from("{}"),
        {},
        mockConfig({ providerId: "contract", credentials: {} }),
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
    const session = await manual.createCheckout({
      orderId: "ord_1",
      attemptId: "att_m",
      amountCents: 100,
      currency: "USD",
      config: mockConfig({ providerId: "manual", credentials: {} }),
    });
    expect(session.action).toMatchObject({ confirmableBy: "admin" });
  });

  it("registers crypto adapters instead of unimplemented stubs", async () => {
    const coinbase = new CoinbaseCommercePaymentAdapter();
    const okx = new OkxOnchainPaymentAdapter();
    const bitpay = new BitpayPaymentAdapter();
    expect(coinbase.provider).toBe("coinbase_commerce");
    expect(okx.provider).toBe("okx_onchain");
    expect(bitpay.provider).toBe("bitpay");
    await expect(
      okx.verifyWebhook(Buffer.from("{}"), {}, mockConfig({ providerId: "okx_onchain" })),
    ).rejects.toMatchObject({ code: "PAYMENT_WEBHOOK_INVALID" });
  });
});

describe("billing country lock", () => {
  it("blocks callers from flipping country after a successful payment", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const existing = {
      id: "bp_1",
      subjectKind: "USER",
      subjectId: "user-1",
      country: "US",
      source: "user",
      locked: true,
    };
    const svc = new BillingProfileService(
      {
        findOne: jest.fn().mockResolvedValue(existing),
        save: jest.fn(async (row: Record<string, unknown>) => {
          saved.push(row);
          return row;
        }),
        create: jest.fn((row: Record<string, unknown>) => row),
      } as never,
      { record: jest.fn() } as never,
    );
    await expect(
      svc.upsertCountry({
        subjectKind: "USER",
        subjectId: "user-1",
        country: "CN",
        source: "user",
        actor: "user-1",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(saved).toHaveLength(0);
    const updated = await svc.upsertCountry({
      subjectKind: "USER",
      subjectId: "user-1",
      country: "DE",
      source: "admin",
      actor: "admin-1",
      reason: "manual review",
      adminOverride: true,
    });
    expect(updated.country).toBe("DE");
  });
});

describe("public webhook orchestration", () => {
  const mock = new MockPaymentAdapter();
  const configRow = {
    id: "cfg-mock",
    providerId: "mock",
    enabled: true,
    status: "active",
    merchantId: "m_1",
    credentialsCiphertext: encryptPaymentSecrets(
      JSON.stringify({ webhookSecret: "whsec_test" }),
      MASTER,
    ),
    previousCredentialsCiphertext: null,
    previousRetiringUntil: null,
    marketScopes: ["GLOBAL"],
    currencies: ["USD"],
    priority: 10,
    capabilities: mockConfig().capabilities,
    environment: "sandbox",
    metadata: {},
  };

  function service(opts: {
    insert?: () => Promise<unknown>;
    order?: Record<string, unknown> | null;
    attempt?: Record<string, unknown> | null;
  }) {
    const fulfilled: string[] = [];
    const events = {
      create: jest.fn((row: Record<string, unknown>) => row),
      save: opts.insert ?? jest.fn().mockResolvedValue(undefined),
      update: jest.fn(),
    };
    const paymentConfigs = {
      loadEnabled: jest.fn().mockResolvedValue(configRow),
      adapterFor: () => mock,
      decryptCurrentAndPrevious: () => [mockConfig()],
      decryptForAdapter: () => mockConfig(),
    };
    const payments = {
      rawBodySha256: () => "hash",
      assertSnapshotMatch: (
        order: { amountCents: number; currency: string },
        _attempt: unknown,
        observed: { amountCents: number; currency: string },
      ) => {
        if (observed.amountCents !== order.amountCents || observed.currency !== order.currency) {
          throw new EntitlementException("PAYMENT_AMOUNT_MISMATCH", "mismatch");
        }
      },
    };
    const dataSource = {
      transaction: async (
        fn: (manager: { findOne: jest.Mock; save: jest.Mock }) => Promise<unknown>,
      ) => {
        fulfilled.push("tx");
        return fn({
          findOne: jest.fn().mockImplementation(async ({ where }: { where: { id?: string } }) => {
            if (where.id === opts.attempt?.id) return { ...opts.attempt, status: "pending" };
            if (where.id === opts.order?.id) return { ...opts.order, status: "pending_payment" };
            return opts.order;
          }),
          save: jest.fn(async (row: unknown) => row),
        });
      },
    };
    const webhook = new PaymentWebhookService(
      dataSource as never,
      events as never,
      {
        findOne: jest.fn().mockResolvedValue(opts.attempt ?? null),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue(opts.order ?? null),
      } as never,
      paymentConfigs as never,
      payments as never,
      { record: jest.fn() } as never,
    );
    return { webhook, events, fulfilled };
  }

  const order = {
    id: "ord_1",
    amountCents: 9900,
    currency: "USD",
    status: "pending_payment",
  };
  const attempt = {
    id: "att_1",
    orderId: "ord_1",
    provider: "mock",
    merchantId: "m_1",
    amountCents: 9900,
    status: "pending",
  };

  it("returns a non-enumerating 404 for unknown or disabled configs", async () => {
    const svc = new PaymentWebhookService(
      { transaction: jest.fn() } as never,
      { create: jest.fn(), save: jest.fn(), update: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { loadEnabled: jest.fn().mockResolvedValue(null) } as never,
      { rawBodySha256: () => "h" } as never,
      { record: jest.fn() } as never,
    );
    await expect(
      svc.handlePublic({
        provider: "mock",
        configId: "missing",
        rawBody: Buffer.from("{}"),
        headers: {},
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects a duplicate event without a second fulfillment", async () => {
    const duplicate = Object.assign(new QueryFailedError("insert", [], new Error("dup")), {
      driverError: { code: "23505" },
    });
    const { webhook, fulfilled } = service({
      insert: async () => {
        throw duplicate;
      },
      order,
      attempt,
    });
    const json = JSON.stringify({
      eventId: "evt_dup",
      orderId: "ord_1",
      attemptId: "att_1",
      providerRef: "mock_att_1",
      amountCents: 9900,
      currency: "USD",
      merchantId: "m_1",
      status: "succeeded",
    });
    const result = await webhook.handlePublic({
      provider: "mock",
      configId: "cfg-mock",
      rawBody: Buffer.from(json),
      headers: signMock(json),
    });
    expect(result.body).toEqual({ received: true });
    expect(fulfilled).toHaveLength(0);
  });

  it("rejects amount / currency / merchant mismatches after verify", async () => {
    const { webhook } = service({ order, attempt });
    const json = JSON.stringify({
      eventId: "evt_amt",
      orderId: "ord_1",
      attemptId: "att_1",
      providerRef: "mock_att_1",
      amountCents: 1,
      currency: "USD",
      merchantId: "m_1",
      status: "succeeded",
    });
    await expect(
      webhook.handlePublic({
        provider: "mock",
        configId: "cfg-mock",
        rawBody: Buffer.from(json),
        headers: signMock(json),
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH" });
  });
});

describe("checkout, reconciliation, and refunds", () => {
  it("creates a pending payment attempt and hosted action", async () => {
    const mock = new MockPaymentAdapter();
    const order = {
      id: "ord_1",
      subjectKind: "USER",
      subjectId: "user-1",
      status: "created",
      amountCents: 9900,
      currency: "USD",
      paymentProvider: "mock",
      returnUrl: null,
      metadata: { market: "GLOBAL" },
    };
    const savedAttempts: Array<Record<string, unknown>> = [];
    const configRow = {
      id: "cfg-mock",
      providerId: "mock",
      enabled: true,
      status: "active",
      merchantId: "m_1",
      marketScopes: ["GLOBAL"],
      currencies: ["USD"],
      priority: 10,
      capabilities: mockConfig().capabilities,
    };
    const manager = {
      findOne: jest.fn().mockResolvedValue(order),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((_cls: unknown, value: Record<string, unknown>) => ({
        id: "att_1",
        ...value,
      })),
      save: jest.fn(async (row: Record<string, unknown>) => {
        if (row.provider === "mock" || row.orderId) savedAttempts.push(row);
        return row;
      }),
    };
    const svc = new PaymentsService(
      {
        getOrThrow: () => ({
          nodeEnv: "test",
          paymentMarketPolicy: "hosted",
          paymentReconcilePendingMinutes: 5,
        }),
      } as never,
      { transaction: async (fn: (m: typeof manager) => Promise<unknown>) => fn(manager) } as never,
      { findOne: jest.fn().mockResolvedValue(order), save: jest.fn() } as never,
      { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() } as never,
      { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() } as never,
      {
        listEnabledRows: jest.fn().mockResolvedValue([configRow]),
        adapterFor: () => mock,
        decryptForAdapter: () => mockConfig(),
        loadEnabled: jest.fn().mockResolvedValue(configRow),
      } as never,
      { get: jest.fn().mockResolvedValue({ country: "US" }) } as never,
      { marketFor: () => "GLOBAL" } as never,
      { record: jest.fn() } as never,
    );
    const result = await svc.startCheckout({
      orderId: "ord_1",
      actor: "user-1",
      expectedSubjectId: "user-1",
      geo: { country: "US", source: "default", trustedProxy: false, directPeerIp: "127.0.0.1" },
      providerHint: "mock",
    });
    expect(result.alreadyPaid).toBe(false);
    expect(result.payment?.checkoutUrl).toContain("att_1");
    expect(result.order.status).toBe("pending_payment");
  });

  it("completes checkout with stored attempt.action, not a browser-replaced action", async () => {
    const storedAction = {
      type: "x402",
      paymentRequired: { accepts: [{ amount: "12000000", payTo: "0xstore" }] },
    };
    const seen: { action?: unknown } = {};
    const adapter = {
      completeCheckout: jest.fn(async (input: { action?: unknown }) => {
        seen.action = input.action;
        return {
          providerRef: "0xabc",
          status: "pending",
          amountCents: 9900,
          currency: "USD",
        };
      }),
    };
    const order = {
      id: "ord_1",
      subjectId: "user-1",
      status: "pending_payment",
      amountCents: 9900,
      currency: "USD",
    };
    const attempt = {
      id: "att_1",
      orderId: "ord_1",
      status: "pending",
      configId: "cfg-okx",
      providerRef: "x402:att_1",
      action: storedAction,
    };
    const svc = new PaymentsService(
      { getOrThrow: () => ({ nodeEnv: "test" }) } as never,
      { transaction: jest.fn() } as never,
      { findOne: jest.fn().mockResolvedValue(order) } as never,
      { findOne: jest.fn().mockResolvedValue(attempt), save: jest.fn() } as never,
      { find: jest.fn() } as never,
      {
        loadEnabled: jest.fn().mockResolvedValue({ id: "cfg-okx", providerId: "okx_onchain" }),
        adapterFor: () => adapter,
        decryptForAdapter: () => mockConfig({ providerId: "okx_onchain" }),
      } as never,
      { get: jest.fn() } as never,
      { marketFor: () => "GLOBAL" } as never,
      { record: jest.fn() } as never,
    );
    await svc.completeCheckout({
      orderId: "ord_1",
      actor: "user-1",
      expectedSubjectId: "user-1",
      buyerProof: {
        paymentPayload: {
          accepted: { amount: "1", payTo: "0xbrowser" },
          paymentRequired: { accepts: [{ amount: "1" }] },
        },
      },
    });
    expect(adapter.completeCheckout).toHaveBeenCalled();
    expect(seen.action).toEqual(storedAction);
    expect(seen.action).not.toMatchObject({
      paymentRequired: { accepts: [{ amount: "1" }] },
    });
  });

  it("reconciles a pending attempt by querying the adapter", async () => {
    const mock = new MockPaymentAdapter();
    await mock.createCheckout({
      orderId: "ord_1",
      attemptId: "att_1",
      amountCents: 9900,
      currency: "USD",
      config: mockConfig(),
    });
    mock.markQuery("mock_att_1", { status: "pending", amountCents: 9900, currency: "USD" });
    const attempt = {
      id: "att_1",
      orderId: "ord_1",
      status: "pending",
      configId: "cfg-mock",
      providerRef: "mock_att_1",
      amountCents: 9900,
      currency: "USD",
      merchantId: "m_1",
    };
    const svc = new PaymentsService(
      {
        getOrThrow: () => ({
          nodeEnv: "test",
          paymentMarketPolicy: "hosted",
          paymentReconcilePendingMinutes: 0,
        }),
      } as never,
      { transaction: jest.fn() } as never,
      {
        findOne: jest.fn().mockResolvedValue({ id: "ord_1", amountCents: 9900, currency: "USD" }),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue(attempt),
        save: jest.fn(async (row: unknown) => row),
        find: jest.fn().mockResolvedValue([attempt]),
      } as never,
      { find: jest.fn() } as never,
      {
        loadEnabled: jest
          .fn()
          .mockResolvedValue({ id: "cfg-mock", providerId: "mock", merchantId: "m_1" }),
        adapterFor: () => mock,
        decryptForAdapter: () => mockConfig(),
      } as never,
      { get: jest.fn() } as never,
      { marketFor: () => "GLOBAL" } as never,
      { record: jest.fn() } as never,
    );
    const result = await svc.reconcileAttempt("att_1", { actor: "admin" });
    expect(result.fulfilled).toBe(false);
    expect(result.query?.status).toBe("pending");
  });

  it("refunds at most the paid amount and revokes only after success", async () => {
    const mock = new MockPaymentAdapter();
    const order = {
      id: "ord_1",
      status: "fulfilled",
      amountCents: 1000,
      currency: "USD",
    };
    const refundsSaved: Array<Record<string, unknown>> = [];
    const svc = new PaymentsService(
      { getOrThrow: () => ({ nodeEnv: "test" }) } as never,
      {
        transaction: async (
          fn: (manager: {
            findOne: jest.Mock;
            find: jest.Mock;
            save: jest.Mock;
          }) => Promise<unknown>,
        ) =>
          fn({
            findOne: jest.fn().mockResolvedValue(order),
            find: jest.fn().mockResolvedValue([]),
            save: jest.fn(async (row: unknown) => row),
          }),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue(order),
        save: jest.fn(async (row: unknown) => row),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue({
          id: "att_1",
          configId: "cfg-mock",
          providerRef: "mock_att_1",
          status: "succeeded",
        }),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((row: Record<string, unknown>) => ({ id: "rf_1", ...row })),
        save: jest.fn(async (row: Record<string, unknown>) => {
          refundsSaved.push(row);
          return row;
        }),
      } as never,
      {
        loadEnabled: jest.fn().mockResolvedValue({
          id: "cfg-mock",
          providerId: "mock",
          capabilities: { refund: true, partialRefund: true },
        }),
        adapterFor: () => mock,
        decryptForAdapter: () => mockConfig(),
      } as never,
      { get: jest.fn() } as never,
      { marketFor: () => "GLOBAL" } as never,
      { record: jest.fn() } as never,
    );
    await expect(
      svc.refundOrder({
        orderId: "ord_1",
        amountCents: 1001,
        idempotencyKey: "k1",
        actor: "admin",
        reason: "too much",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_REFUND_UNSUPPORTED" });

    const full = await svc.refundOrder({
      orderId: "ord_1",
      amountCents: 1000,
      idempotencyKey: "k2",
      actor: "admin",
      reason: "customer request",
      ticket: "T-1",
    });
    expect(full.refund.status).toBe("succeeded");
    expect(full.idempotent).toBe(false);
    expect(refundsSaved.at(-1)?.status).toBe("succeeded");
  });

  it("requires admin reason and ticket for manual confirmation", async () => {
    const svc = new PaymentsService(
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
    await expect(
      svc.confirmManual({ orderId: "ord_1", actor: "user-1", reason: "", ticket: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
