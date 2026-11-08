import { Logger } from "@nestjs/common";
import { QueryFailedError, type EntityManager } from "typeorm";
import { planAiCreditGrant, type AiCreditPlanInput } from "../../common/ai-credit-policy";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";

const logger = new Logger("AiCreditOutbox");

export function aiCreditGrantDedupeKey(orderId: string): string {
  return `ai.credit.grant:${orderId}`;
}

export function aiCreditRevokeDedupeKey(orderId: string): string {
  return `ai.credit.revoke:${orderId}`;
}

/** Idempotent on the cumulative target micro for a partial refund. */
export function aiCreditRevokePartialDedupeKey(orderId: string, targetMicro: number): string {
  return `ai.credit.revoke:${orderId}:to:${targetMicro}`;
}

/**
 * Same transaction as order.fulfilled. Unconfigured SKUs are logged and skipped
 * so payment fulfillment still commits.
 */
export async function enqueueAiCreditGrant(
  manager: EntityManager,
  input: AiCreditPlanInput,
): Promise<void> {
  const planned = planAiCreditGrant(input);
  if (!planned.ok) {
    logger.warn(`Skipping ai.credit.grant for order ${input.order.id}: ${planned.reason}`);
    return;
  }
  const dedupeKey = aiCreditGrantDedupeKey(input.order.id);
  const existing = await manager.findOne(OutboxEventEntity, { where: { dedupeKey } });
  if (existing) return;
  await saveOutbox(manager, {
    eventType: "ai.credit.grant",
    dedupeKey,
    payload: planned.payload as unknown as Record<string, unknown>,
  });
}

/**
 * Full refund: seal the grant and recover whatever remaining is left.
 * No grant row means this order never queued credits.
 */
export async function enqueueAiCreditRevoke(
  manager: EntityManager,
  orderId: string,
): Promise<void> {
  const grant = await manager.findOne(OutboxEventEntity, {
    where: { dedupeKey: aiCreditGrantDedupeKey(orderId) },
  });
  if (!grant) {
    logger.log(`Skipping ai.credit.revoke for order ${orderId}: no ai.credit.grant outbox row`);
    return;
  }
  const dedupeKey = aiCreditRevokeDedupeKey(orderId);
  const existing = await manager.findOne(OutboxEventEntity, { where: { dedupeKey } });
  if (existing) return;
  const payload: Record<string, unknown> = { orderId, seal: true };
  const amount = grant.payload?.amountMicro;
  if (typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0) {
    payload.amountMicro = amount;
  }
  await saveOutbox(manager, {
    eventType: "ai.credit.revoke",
    dedupeKey,
    payload,
  });
}

/**
 * Partial refund clawback. targetMicro = floor(grantMicro * netRefundedCents / orderCents).
 * Sends only the delta since prior partial revokes so AI Platform can take from remaining
 * without sealing. Closes the arbitrage hole where a partial refund left credits spendable
 * at full face value.
 */
export async function enqueueAiCreditRevokePartial(
  manager: EntityManager,
  input: { orderId: string; netRefundedCents: number; orderAmountCents: number },
): Promise<void> {
  const { orderId, netRefundedCents, orderAmountCents } = input;
  if (netRefundedCents <= 0 || orderAmountCents <= 0) return;
  if (netRefundedCents >= orderAmountCents) {
    await enqueueAiCreditRevoke(manager, orderId);
    return;
  }
  const grant = await manager.findOne(OutboxEventEntity, {
    where: { dedupeKey: aiCreditGrantDedupeKey(orderId) },
  });
  if (!grant) {
    logger.log(`Skipping partial ai.credit.revoke for order ${orderId}: no grant outbox row`);
    return;
  }
  const grantMicro = grant.payload?.amountMicro;
  if (typeof grantMicro !== "number" || !Number.isSafeInteger(grantMicro) || grantMicro <= 0) {
    logger.warn(`Skipping partial ai.credit.revoke for order ${orderId}: grant amountMicro missing`);
    return;
  }
  const targetMicro = Math.floor((grantMicro * netRefundedCents) / orderAmountCents);
  if (targetMicro <= 0) return;

  const prior = await manager.find(OutboxEventEntity, {
    where: { eventType: "ai.credit.revoke" },
  });
  let already = 0;
  for (const row of prior) {
    if (!String(row.dedupeKey ?? "").startsWith(`ai.credit.revoke:${orderId}`)) continue;
    if (row.payload?.seal === true) continue;
    const amt = row.payload?.amountMicro;
    if (typeof amt === "number" && Number.isSafeInteger(amt) && amt > 0) already += amt;
  }
  const delta = targetMicro - already;
  if (delta <= 0) return;

  const dedupeKey = aiCreditRevokePartialDedupeKey(orderId, targetMicro);
  const existing = await manager.findOne(OutboxEventEntity, { where: { dedupeKey } });
  if (existing) return;
  await saveOutbox(manager, {
    eventType: "ai.credit.revoke",
    dedupeKey,
    payload: {
      orderId,
      amountMicro: delta,
      seal: false,
      targetMicro,
      netRefundedCents,
      orderAmountCents,
    },
  });
}

async function saveOutbox(
  manager: EntityManager,
  row: { eventType: string; dedupeKey: string; payload: Record<string, unknown> },
): Promise<void> {
  try {
    await manager.save(manager.create(OutboxEventEntity, row));
  } catch (err) {
    if (isUniqueViolation(err)) return;
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof QueryFailedError) {
    const driver = err.driverError as { code?: string } | undefined;
    return driver?.code === "23505";
  }
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
