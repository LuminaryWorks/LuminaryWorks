import { randomUUID } from "node:crypto";
import { BillingProfileEntity } from "../src/database/entities/billing-profile.entity";
import { GrantEntity } from "../src/database/entities/grant.entity";
import { OrderEntity } from "../src/database/entities/order.entity";
import { OutboxEventEntity } from "../src/database/entities/outbox-event.entity";
import { PaymentAttemptEntity } from "../src/database/entities/payment-attempt.entity";
import { SubscriptionEntity } from "../src/database/entities/subscription.entity";
import { DoerflowCreditPaymentAdapter } from "../src/modules/payments/doerflow-credit.adapter";
import {
  computeDoerflowWebhookSignature,
  deriveChargeEventId,
  deriveChargeIdempotencyKey,
  MERCHANT_CHARGE_EVENT_TYPE,
  toLedgerAmountMinor,
} from "../src/modules/payments/doerflow-credit";
import { PaymentWebhookService } from "../src/modules/payments/payment-webhook.service";
import { PaymentsService } from "../src/modules/payments/payments.service";
import { doerflowCreditConfig, jsonResponse } from "./payment-adapter-fixtures";

const fixedNow = new Date("2026-09-17T04:00:00Z");
const clock = { now: () => fixedNow };
const config = doerflowCreditConfig();

function signed(payload: Record<string, unknown>, nonce: string) {
  const timestamp = String(Math.floor(fixedNow.getTime() / 1000));
  const body = Buffer.from(JSON.stringify(payload));
  return {
    body,
    headers: {
      "x-lw-timestamp": timestamp,
      "x-lw-nonce": nonce,
      "x-lw-signature": `v1=${computeDoerflowWebhookSignature(
        config.credentials.webhookSecret,
        timestamp,
        nonce,
        body,
      )}`,
    },
  };
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value && typeof value === "object") continue;
    if (row[key] !== value) return false;
  }
  return true;
}

describe("doerflow_credit charge grant and refund revoke", () => {
  it("fulfills one plan grant for a replayed webhook and revokes it after refund", async () => {
    const order = {
      id: "ord_1",
      subjectKind: "USER" as const,
      subjectId: "user_1",
      productCode: "doerflow",
      planCode: "pro" as const,
      status: "pending_payment",
      amountCents: 1200,
      currency: "USD",
      interval: "month",
      offeringSku: "doerflow.pro.month.USD",
      bundleSku: null,
      metadata: {},
      providerRef: null as string | null,
    };
    const attempt = {
      id: "att_1",
      orderId: order.id,
      configId: config.id,
      provider: "doerflow_credit",
      providerRef: "chg_1",
      status: "pending",
      amountCents: 1200,
      currency: "USD",
      merchantId: "acct_lw_platform",
    };
    const buckets = new Map<object, Array<Record<string, unknown>>>();
    const product = { code: "doerflow", status: "active", active: true };
    const chain = {
      update: () => chain,
      set: () => chain,
      where: () => chain,
      andWhere: () => chain,
      execute: async () => ({ affected: 0 }),
    };
    const manager = {
      query: async () => [],
      createQueryBuilder: () => chain,
      getRepository: () => ({
        find: async () => [product],
        findOne: async () => null,
      }),
      create: (entity: object, value: Record<string, unknown> = {}) => ({
        ...value,
        id: typeof value.id === "string" ? value.id : randomUUID(),
        __entity: entity,
      }),
      save: async (row: Record<string, unknown>) => {
        const entity = row.__entity;
        if (typeof entity !== "function") return row;
        const bucket = buckets.get(entity) ?? [];
        buckets.set(entity, bucket);
        const idx = bucket.findIndex((item) => item.id === row.id);
        if (idx >= 0) bucket[idx] = row;
        else bucket.push(row);
        return row;
      },
      findOne: async (entity: object, opts?: { where?: Record<string, unknown> }) => {
        if (entity === OrderEntity) return order;
        if (entity === PaymentAttemptEntity) return attempt;
        if (entity === BillingProfileEntity) return null;
        const where = opts?.where ?? {};
        return (buckets.get(entity) ?? []).find((row) => matches(row, where)) ?? null;
      },
      find: async (entity: object, opts?: { where?: Record<string, unknown> }) => {
        const where = opts?.where ?? {};
        return (buckets.get(entity) ?? []).filter((row) => matches(row, where));
      },
    };

    let transactions = 0;
    const dataSource = {
      transaction: async (fn: (tx: typeof manager) => Promise<unknown>) => {
        transactions += 1;
        return fn(manager);
      },
    };
    const refundsSaved: Array<Record<string, unknown>> = [];
    const refunds = {
      findOne: async ({ where }: { where: { idempotencyKey?: string } }) =>
        refundsSaved.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null,
      find: async () =>
        refundsSaved.filter((row) => row.orderId === order.id && row.status === "succeeded"),
      create: (value: Record<string, unknown>) => ({ id: "rf_1", ...value }),
      save: async (row: Record<string, unknown>) => {
        const idx = refundsSaved.findIndex((item) => item.id === row.id);
        if (idx >= 0) refundsSaved[idx] = row;
        else refundsSaved.push(row);
        return row;
      },
    };
    const attempts = {
      findOne: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id && where.id !== attempt.id) return null;
        if (where.orderId && where.orderId !== attempt.orderId) return null;
        if (where.providerRef && where.providerRef !== attempt.providerRef) return null;
        if (typeof where.status === "string" && where.status !== attempt.status) return null;
        return attempt;
      },
      save: async (row: unknown) => row,
    };
    const orders = {
      findOne: async () => order,
      save: async (row: unknown) => row,
    };
    const seenRefunds: string[] = [];
    const adapter = new DoerflowCreditPaymentAdapter(async (_url, init) => {
      seenRefunds.push(typeof init?.body === "string" ? init.body : "");
      return jsonResponse({ status: "succeeded", refundId: "rf_remote" });
    }, clock);
    const paymentConfigs = {
      loadEnabled: async () => config,
      adapterFor: () => adapter,
      decryptForAdapter: () => config,
      decryptCurrentAndPrevious: () => [config],
    };
    const payments = new PaymentsService(
      { getOrThrow: () => ({}) } as never,
      dataSource as never,
      orders as never,
      attempts as never,
      refunds as never,
      paymentConfigs as never,
      { get: async () => null } as never,
      { marketFor: () => "GLOBAL" } as never,
      { record: async () => undefined } as never,
    );
    const eventsSaved: Array<Record<string, unknown>> = [];
    const events = {
      create: (value: Record<string, unknown>) => ({ id: randomUUID(), ...value }),
      save: async (row: Record<string, unknown>) => {
        const dup = eventsSaved.find(
          (item) =>
            item.provider === row.provider &&
            item.configId === row.configId &&
            item.eventId === row.eventId,
        );
        if (dup) {
          const err = new Error("duplicate");
          (err as { code?: string }).code = "23505";
          throw err;
        }
        eventsSaved.push(row);
        return row;
      },
      findOne: async ({ where }: { where: Record<string, unknown> }) =>
        eventsSaved.find((row) => matches(row, where)) ?? null,
      update: async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
        const row = eventsSaved.find((item) => matches(item, where));
        if (row) Object.assign(row, patch);
      },
    };
    const webhooks = new PaymentWebhookService(
      dataSource as never,
      events as never,
      attempts as never,
      orders as never,
      paymentConfigs as never,
      payments,
      { record: async () => undefined } as never,
    );

    const eventId = deriveChargeEventId(deriveChargeIdempotencyKey(order.id, attempt.id));
    const payload = {
      eventType: MERCHANT_CHARGE_EVENT_TYPE,
      eventId,
      orderId: order.id,
      chargeId: attempt.providerRef,
      status: "succeeded",
      amountMinor: toLedgerAmountMinor(1200),
      currency: "USD",
      asset: "USDC",
      merchantAccount: "acct_lw_platform",
      settledAt: fixedNow.toISOString(),
    };
    const first = signed(payload, "nonce_grant_01");
    const granted = await webhooks.handlePublic({
      provider: "doerflow_credit",
      configId: config.id,
      rawBody: first.body,
      headers: first.headers,
    });
    expect(granted.body).toEqual({ received: true });
    expect(order.status).toBe("fulfilled");
    const grants = () => buckets.get(GrantEntity) ?? [];
    expect(grants()).toHaveLength(1);
    expect(grants()[0]).toMatchObject({
      productCode: "doerflow",
      planCode: "pro",
      revoked: false,
      subjectId: "user_1",
    });

    const replay = signed(payload, "nonce_grant_02");
    const again = await webhooks.handlePublic({
      provider: "doerflow_credit",
      configId: config.id,
      rawBody: replay.body,
      headers: replay.headers,
    });
    expect(again.body).toEqual({ received: true });
    expect(grants()).toHaveLength(1);
    expect(transactions).toBe(1);

    const refunded = await payments.refundOrder({
      orderId: order.id,
      amountCents: 1200,
      idempotencyKey: "refund_grant_1",
      actor: "admin",
      reason: "lab revoke",
    });
    expect(refunded.idempotent).toBe(false);
    expect(refunded.refund.status).toBe("succeeded");
    expect(order.status).toBe("refunded");
    expect(grants()[0]?.revoked).toBe(true);
    expect((buckets.get(SubscriptionEntity) ?? [])[0]?.status).toBe("canceled");
    const refundBody = JSON.parse(seenRefunds[0] ?? "{}") as Record<string, unknown>;
    expect(refundBody.originalIdempotencyKey).toBe(
      deriveChargeIdempotencyKey(order.id, attempt.id),
    );
    expect(seenRefunds).toHaveLength(1);

    const replayed = await payments.refundOrder({
      orderId: order.id,
      amountCents: 1200,
      idempotencyKey: "refund_grant_1",
      actor: "admin",
      reason: "lab revoke",
    });
    expect(replayed.idempotent).toBe(true);
    expect(seenRefunds).toHaveLength(1);
    expect(grants()).toHaveLength(1);
    expect(transactions).toBe(2);
    expect(buckets.get(OutboxEventEntity)?.some((row) => row.eventType === "order.fulfilled")).toBe(
      true,
    );
  });
});
