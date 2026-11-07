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
 * Full-refund companion to ai.credit.grant. No grant row means this order never
 * queued credits, so revoke is skipped. Partial refunds must not call this:
 * there is no cents→micro formula in this slice.
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
  const payload: Record<string, unknown> = { orderId };
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
