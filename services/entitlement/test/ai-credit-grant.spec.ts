import type { EntityManager } from "typeorm";
import {
  parseAiCreditPolicy,
  planAiCreditGrant,
  type AiCreditGrantPayload,
  type AiCreditPolicy,
} from "../src/common/ai-credit-policy";
import entitlementConfig from "../src/config/entitlement.config";
import type { EntitlementConfig } from "../src/config/entitlement.config";
import { BillingProfileEntity } from "../src/database/entities/billing-profile.entity";
import { OrderEntity } from "../src/database/entities/order.entity";
import { OutboxEventEntity } from "../src/database/entities/outbox-event.entity";
import { deliverAiCredit } from "../src/modules/notify/ai-credit-deliver";
import {
  aiCreditGrantDedupeKey,
  aiCreditRevokeDedupeKey,
  enqueueAiCreditGrant,
  enqueueAiCreditRevoke,
  enqueueAiCreditRevokePartial,
  aiCreditRevokePartialDedupeKey,
} from "../src/modules/orders/ai-credit-outbox";
import { fulfillPaidOrderTx } from "../src/modules/orders/order-fulfillment";

const PACK_SKU = "blockyedu.voice.pack.1800s";

type Saved = {
  eventType?: string;
  dedupeKey?: string;
  payload?: AiCreditGrantPayload | Record<string, unknown>;
  features?: Record<string, { effect: string; limitValue?: number }>;
  status?: string;
};

function baseOrder(overrides: Partial<OrderEntity> = {}): OrderEntity {
  return {
    id: "ord-1",
    subjectKind: "USER",
    subjectId: "user-1",
    productCode: "blockyedu",
    planCode: null,
    bundleSku: null,
    offeringSku: PACK_SKU,
    interval: null,
    status: "pending_payment",
    currency: "CNY",
    metadata: { kind: "quota_pack", packSku: PACK_SKU },
    ...overrides,
  } as OrderEntity;
}

function harness(order: OrderEntity) {
  const saved: Saved[] = [];
  const manager = {
    async findOne(entity: unknown, opts?: { where?: { dedupeKey?: string } }) {
      if (entity === OutboxEventEntity) {
        const key = opts?.where?.dedupeKey;
        return saved.find((row) => row.dedupeKey === key) ?? null;
      }
      if (entity === OrderEntity || entity === BillingProfileEntity) {
        return entity === OrderEntity ? order : null;
      }
      return null;
    },
    async find(entity: unknown, opts?: { where?: { eventType?: string } }) {
      if (entity === OutboxEventEntity) {
        const type = opts?.where?.eventType;
        return type ? saved.filter((row) => row.eventType === type) : [...saved];
      }
      return [];
    },
    async query() {
      throw new Error("unexpected SQL");
    },
    getRepository() {
      return {
        async find() {
          return [
            { code: "blockyedu", active: true },
            { code: "vistaremote", active: true },
          ];
        },
      };
    },
    create(_entity: unknown, data: Saved) {
      return { ...data };
    },
    async save(row: Saved) {
      saved.push(row);
      return row;
    },
  };
  return { saved, manager: manager as unknown as EntityManager };
}

function ofType(saved: Saved[], eventType: string): Saved[] {
  return saved.filter((row) => row.eventType === eventType);
}

describe("AI credit grant policy", () => {
  it("parses a sku map and leaves voice conversion unset", () => {
    expect(
      parseAiCreditPolicy({
        AI_CREDIT_GRANT_BY_SKU_JSON: JSON.stringify({
          [PACK_SKU]: 1800000,
          "vistaremote.pro.month": {
            amountMicro: 50,
            currency: "USD",
            kind: "subscription",
            expiresAt: null,
            restrictTo: { productCodes: ["vistaremote"], capabilities: ["chat"] },
          },
        }),
      }),
    ).toEqual({
      microPerVoiceSecond: null,
      bySku: {
        [PACK_SKU]: { amountMicro: 1800000 },
        "vistaremote.pro.month": {
          amountMicro: 50,
          currency: "USD",
          kind: "subscription",
          expiresAt: null,
          restrictTo: { productCodes: ["vistaremote"], capabilities: ["chat"] },
        },
      },
    });
  });

  it("rejects a broken map and a non-positive voice rate", () => {
    expect(() => parseAiCreditPolicy({ AI_CREDIT_GRANT_BY_SKU_JSON: "[" })).toThrow(
      /not valid JSON/,
    );
    expect(() => parseAiCreditPolicy({ AI_CREDIT_MICRO_PER_VOICE_SECOND: "0" })).toThrow(
      /positive integer/,
    );
  });

  it("skips deployment subjects and unconfigured skus without a zero grant", () => {
    const products = [{ productCode: "vistaremote", planCode: "pro" as const, endsAt: null }];
    const policy: AiCreditPolicy = { bySku: {}, microPerVoiceSecond: null };
    expect(
      planAiCreditGrant({
        order: {
          id: "ord-dep",
          subjectKind: "DEPLOYMENT",
          subjectId: "dep-1",
          currency: "USD",
          planCode: "pro",
          metadata: {},
        },
        sku: "vistaremote.pro.month",
        products,
        policy: {
          bySku: { "vistaremote.pro.month": { amountMicro: 10 } },
          microPerVoiceSecond: null,
        },
      }).ok,
    ).toBe(false);
    const skipped = planAiCreditGrant({
      order: {
        id: "ord-user",
        subjectKind: "USER",
        subjectId: "user-1",
        currency: "USD",
        planCode: "pro",
        metadata: {},
      },
      sku: "missing.sku",
      products,
      policy,
    });
    expect(skipped.ok).toBe(false);
  });
});

describe("fulfillPaidOrderTx ai.credit.grant", () => {
  const policy: AiCreditPolicy = {
    bySku: { [PACK_SKU]: { amountMicro: 1_800_000 } },
    microPerVoiceSecond: null,
  };

  it("writes an independent grant event and does not duplicate it", async () => {
    const order = baseOrder();
    const { saved, manager } = harness(order);
    const fulfilled = await fulfillPaidOrderTx(manager, order.id, "pay_1", { policy });
    await fulfillPaidOrderTx(manager, order.id, "pay_1", { policy });
    await enqueueAiCreditGrant(manager, {
      order,
      sku: PACK_SKU,
      products: [{ productCode: "blockyedu", planCode: null, endsAt: null }],
      policy,
    });

    expect(fulfilled?.status).toBe("fulfilled");
    expect(ofType(saved, "order.fulfilled")).toHaveLength(1);
    const grants = ofType(saved, "ai.credit.grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.dedupeKey).toBe(aiCreditGrantDedupeKey("ord-1"));
    const payload = grants[0]?.payload as AiCreditGrantPayload;
    expect(payload).toMatchObject({
      orderId: "ord-1",
      walletOwner: { kind: "user", id: "user-1" },
      amountMicro: 1_800_000,
      currency: "CNY",
      restrictTo: { productCodes: ["blockyedu"] },
      kind: "topup",
    });
    expect(payload.expiresAt).toEqual(expect.any(String));
    expect(saved.some((row) => row.features?.["ai.voice"]?.effect === "allow")).toBe(true);
  });

  it("keeps fulfillment when the sku has no credit mapping", async () => {
    const order = baseOrder();
    const { saved, manager } = harness(order);
    const fulfilled = await fulfillPaidOrderTx(manager, order.id, "pay_1", {
      policy: { bySku: {}, microPerVoiceSecond: null },
    });
    expect(fulfilled?.status).toBe("fulfilled");
    expect(ofType(saved, "order.fulfilled")).toHaveLength(1);
    expect(ofType(saved, "ai.credit.grant")).toHaveLength(0);
    expect(saved.some((row) => row.features?.["ai.voice"]?.effect === "allow")).toBe(true);
  });

  it("converts voice-pack seconds only when the rate is set, and the sku map wins", async () => {
    const order = baseOrder();
    const voice = harness(order);
    await fulfillPaidOrderTx(voice.manager, order.id, "pay_1", {
      policy: { bySku: {}, microPerVoiceSecond: 1000 },
    });
    const voicePayload = ofType(voice.saved, "ai.credit.grant")[0]?.payload as AiCreditGrantPayload;
    expect(voicePayload.amountMicro).toBe(1800 * 1000);

    const mappedOrder = baseOrder({ id: "ord-mapped", status: "pending_payment" });
    const mapped = harness(mappedOrder);
    await fulfillPaidOrderTx(mapped.manager, mappedOrder.id, "pay_1", {
      policy: {
        bySku: { [PACK_SKU]: { amountMicro: 42 } },
        microPerVoiceSecond: 1000,
      },
    });
    const mappedPayload = ofType(mapped.saved, "ai.credit.grant")[0]
      ?.payload as AiCreditGrantPayload;
    expect(mappedPayload.amountMicro).toBe(42);
  });

  it("uses an organization wallet for an organization subscription", async () => {
    const order = baseOrder({
      id: "ord-org",
      subjectKind: "ORGANIZATION",
      subjectId: "org-1",
      productCode: "vistaremote",
      planCode: "pro",
      offeringSku: "vistaremote.pro.month",
      interval: "month",
      currency: "USD",
      metadata: { kind: "offering" },
      status: "created",
    });
    const { saved, manager } = harness(order);
    const fulfilled = await fulfillPaidOrderTx(manager, order.id, "pay_1", {
      policy: {
        bySku: { "vistaremote.pro.month": { amountMicro: 5_000_000, kind: "subscription" } },
        microPerVoiceSecond: null,
      },
    });
    expect(fulfilled?.status).toBe("fulfilled");
    const payload = ofType(saved, "ai.credit.grant")[0]?.payload as AiCreditGrantPayload;
    expect(payload.walletOwner).toEqual({ kind: "organization", id: "org-1" });
    expect(payload.kind).toBe("subscription");
    expect(payload.currency).toBe("USD");
    expect(payload.restrictTo).toEqual({ productCodes: ["vistaremote"] });
    expect(Date.parse(payload.expiresAt ?? "")).toBeGreaterThan(Date.now());
  });

  it("enqueues revoke once when a grant exists and skips it otherwise", async () => {
    const order = baseOrder();
    const { saved, manager } = harness(order);
    await enqueueAiCreditRevoke(manager, order.id);
    expect(ofType(saved, "ai.credit.revoke")).toHaveLength(0);

    await fulfillPaidOrderTx(manager, order.id, "pay_1", { policy });
    await enqueueAiCreditRevoke(manager, order.id);
    await enqueueAiCreditRevoke(manager, order.id);
    const revokes = ofType(saved, "ai.credit.revoke");
    expect(revokes).toHaveLength(1);
    expect(revokes[0]?.dedupeKey).toBe(aiCreditRevokeDedupeKey("ord-1"));
    expect(revokes[0]?.payload).toEqual({
      orderId: "ord-1",
      amountMicro: 1_800_000,
      seal: true,
    });
  });

  it("enqueues proportional partial revokes and seals on a full refund", async () => {
    const order = baseOrder({ amountCents: 10_000 });
    const { saved, manager } = harness(order);
    const policy = parseAiCreditPolicy({
      AI_CREDIT_MICRO_PER_VOICE_SECOND: "1000",
    });
    await fulfillPaidOrderTx(manager, order.id, "pay_partial", { policy });
    expect((ofType(saved, "ai.credit.grant")[0]?.payload as { amountMicro: number }).amountMicro).toBe(
      1_800_000,
    );

    await enqueueAiCreditRevokePartial(manager, {
      orderId: order.id,
      netRefundedCents: 4_000,
      orderAmountCents: 10_000,
    });
    let revokes = ofType(saved, "ai.credit.revoke");
    expect(revokes).toHaveLength(1);
    expect(revokes[0]?.dedupeKey).toBe(aiCreditRevokePartialDedupeKey(order.id, 720_000));
    expect(revokes[0]?.payload).toMatchObject({
      amountMicro: 720_000,
      seal: false,
      targetMicro: 720_000,
    });

    await enqueueAiCreditRevokePartial(manager, {
      orderId: order.id,
      netRefundedCents: 4_000,
      orderAmountCents: 10_000,
    });
    expect(ofType(saved, "ai.credit.revoke")).toHaveLength(1);

    await enqueueAiCreditRevokePartial(manager, {
      orderId: order.id,
      netRefundedCents: 7_000,
      orderAmountCents: 10_000,
    });
    revokes = ofType(saved, "ai.credit.revoke");
    expect(revokes).toHaveLength(2);
    expect(revokes[1]?.payload).toMatchObject({ amountMicro: 540_000, seal: false });

    await enqueueAiCreditRevokePartial(manager, {
      orderId: order.id,
      netRefundedCents: 10_000,
      orderAmountCents: 10_000,
    });
    expect(ofType(saved, "ai.credit.revoke").some((row) => (row.payload as { seal?: boolean })?.seal === true)).toBe(
      true,
    );
  });
});

describe("deliverAiCredit", () => {
  const payload = {
    orderId: "ord-1",
    walletOwner: { kind: "user", id: "user-1" },
    amountMicro: 10,
    currency: "USD",
    expiresAt: null,
    restrictTo: { productCodes: ["blockyedu"] },
    kind: "topup",
  };

  it("posts the payload with the internal service key", async () => {
    const seen = { url: "", method: "", serviceKey: "", contentType: "", body: "" };
    await deliverAiCredit({
      event: { eventType: "ai.credit.grant", payload },
      baseUrl: "http://ai-platform:13100/",
      serviceKey: "internal-key",
      fetchImpl: async (url, init) => {
        seen.url = url;
        seen.method = init.method;
        seen.serviceKey = init.headers["x-service-key"] ?? "";
        seen.contentType = init.headers["content-type"] ?? "";
        seen.body = init.body;
        return { status: 200, text: async () => "" };
      },
    });
    expect(seen.url).toBe("http://ai-platform:13100/v1/internal/credits/grant");
    expect(seen.method).toBe("POST");
    expect(seen.serviceKey).toBe("internal-key");
    expect(seen.contentType).toBe("application/json");
    expect(JSON.parse(seen.body)).toEqual(payload);
  });

  it("posts revoke to the revoke path", async () => {
    let url = "";
    await deliverAiCredit({
      event: { eventType: "ai.credit.revoke", payload: { orderId: "ord-1", amountMicro: 10 } },
      baseUrl: "http://ai-platform:13100",
      serviceKey: "internal-key",
      fetchImpl: async (next) => {
        url = next;
        return { status: 204, text: async () => "" };
      },
    });
    expect(url).toBe("http://ai-platform:13100/v1/internal/credits/revoke");
  });

  it("marks the event sent without fetching when the base URL is unset", async () => {
    const warnings: string[] = [];
    await expect(
      deliverAiCredit({
        event: { eventType: "ai.credit.grant", payload },
        baseUrl: "  ",
        serviceKey: "",
        fetchImpl: async () => {
          throw new Error("must not fetch");
        },
        warn: (message) => warnings.push(message),
      }),
    ).resolves.toBe("sent");
    expect(warnings[0]).toMatch(/AI_PLATFORM_BASE_URL unset/);
  });

  it("throws on non-2xx so the outbox retry path can run", async () => {
    await expect(
      deliverAiCredit({
        event: { eventType: "ai.credit.grant", payload },
        baseUrl: "http://ai-platform:13100",
        serviceKey: "internal-key",
        fetchImpl: async () => ({ status: 503, text: async () => "unavailable" }),
      }),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("entitlement AI platform config", () => {
  const keys = [
    "AI_PLATFORM_BASE_URL",
    "AI_PLATFORM_INTERNAL_SERVICE_KEY",
    "AI_CREDIT_GRANT_BY_SKU_JSON",
    "AI_CREDIT_MICRO_PER_VOICE_SECOND",
    // Shell/control-plane.env can leave a non-JSON stub that breaks entitlementConfig().
    "ENTITLEMENT_LICENSE_PUBLIC_KEYS",
  ] as const;
  const previous = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of keys) previous.set(key, process.env[key]);
  });

  afterEach(() => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("boots with an empty base URL and reads the service key when set", () => {
    delete process.env.AI_PLATFORM_BASE_URL;
    delete process.env.AI_PLATFORM_INTERNAL_SERVICE_KEY;
    delete process.env.AI_CREDIT_GRANT_BY_SKU_JSON;
    delete process.env.AI_CREDIT_MICRO_PER_VOICE_SECOND;
    delete process.env.ENTITLEMENT_LICENSE_PUBLIC_KEYS;
    const empty = entitlementConfig() as EntitlementConfig;
    expect(empty.aiPlatformBaseUrl).toBe("");
    expect(empty.aiPlatformInternalServiceKey).toBe("");

    process.env.AI_PLATFORM_BASE_URL = " http://ai-platform:13100 ";
    process.env.AI_PLATFORM_INTERNAL_SERVICE_KEY = "internal-key";
    process.env.AI_CREDIT_GRANT_BY_SKU_JSON = "{}";
    const set = entitlementConfig() as EntitlementConfig;
    expect(set.aiPlatformBaseUrl).toBe("http://ai-platform:13100");
    expect(set.aiPlatformInternalServiceKey).toBe("internal-key");
  });

  it("refuses to boot when the sku map is not JSON", () => {
    process.env.AI_CREDIT_GRANT_BY_SKU_JSON = "{";
    expect(() => entitlementConfig()).toThrow(/not valid JSON/);
  });
});
