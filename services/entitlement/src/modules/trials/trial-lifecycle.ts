import type { EntityManager } from "typeorm";
import { GrantEntity } from "../../database/entities/grant.entity";
import { LicenseEntity } from "../../database/entities/license.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { TrialCleanupJobEntity } from "../../database/entities/trial-cleanup-job.entity";
import { isActiveWindow } from "../entitlements/resolution";

export const TRIAL_LIFECYCLE_EVENT_TYPES = [
  "trial.expiring",
  "trial.expiring_t1",
  "trial.expired",
  "trial.purge",
] as const;

export type TrialLifecycleEventType = (typeof TRIAL_LIFECYCLE_EVENT_TYPES)[number];

export const PAID_PLAN_CODES = ["pro", "ultra", "enterprise"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function trialLifecycleLockKey(logtoSub: string, productCode: string): string {
  return `trial-purge:${logtoSub}:${productCode}`;
}

export async function acquireTrialLifecycleLock(
  manager: EntityManager,
  logtoSub: string,
  productCode: string,
): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    trialLifecycleLockKey(logtoSub, productCode),
  ]);
}

export function trialNotifyDedupeKey(
  logtoSub: string,
  productCode: string,
  eventType: TrialLifecycleEventType,
  scheduledFor: Date,
): string {
  if (eventType === "trial.expiring" || eventType === "trial.expiring_t1") {
    return `${logtoSub}:${productCode}:${eventType}:${scheduledFor.toISOString().slice(0, 10)}`;
  }
  return `${logtoSub}:${productCode}:${eventType}:${scheduledFor.toISOString()}`;
}

export function trialScheduleAnchors(
  startsAt: Date,
  endsAt: Date,
): {
  t3: Date;
  t1: Date;
  expired: Date;
  purge: Date;
} {
  const t3Raw = new Date(endsAt.getTime() - 3 * DAY_MS);
  const t1Raw = new Date(endsAt.getTime() - 1 * DAY_MS);
  return {
    t3: t3Raw > startsAt ? t3Raw : startsAt,
    t1: t1Raw > startsAt ? t1Raw : startsAt,
    expired: endsAt,
    purge: endsAt,
  };
}

export function trialLifecyclePayload(input: {
  trialRedemptionId: string;
  subscriptionId: string;
  logtoSub: string;
  productCode: string;
  startsAt: Date;
  endsAt: Date;
  policyVersion: string;
}): Record<string, unknown> {
  return {
    trialRedemptionId: input.trialRedemptionId,
    subscriptionId: input.subscriptionId,
    logtoSub: input.logtoSub,
    productCode: input.productCode,
    startsAt: input.startsAt.toISOString(),
    endsAt: input.endsAt.toISOString(),
    policyVersion: input.policyVersion,
  };
}

export function trialNotifyCopy(
  eventType: "trial.expiring" | "trial.expiring_t1" | "trial.expired",
  productCode: string,
  endsAt: string,
): { title: string; body: string } {
  if (eventType === "trial.expiring") {
    return {
      title: `Your ${productCode} trial ends in 3 days`,
      body: `Upgrade to Pro to keep premium features after ${endsAt}.`,
    };
  }
  if (eventType === "trial.expiring_t1") {
    return {
      title: `Your ${productCode} trial ends in 1 day`,
      body: `Upgrade to Pro to keep premium features after ${endsAt}. Data deletion begins after ${endsAt}.`,
    };
  }
  return {
    title: `Your ${productCode} trial has ended`,
    body: `Upgrade to Pro to restore premium features for ${productCode}.`,
  };
}

export async function cancelTrialLifecycle(
  manager: EntityManager,
  logtoSub: string,
  productCode: string,
): Promise<{ events: number; jobs: number }> {
  const events = await manager
    .createQueryBuilder()
    .update(OutboxEventEntity)
    .set({ status: "canceled", lockedUntil: null, lockedBy: null })
    .where("status IN (:...st)", { st: ["pending", "failed", "processing"] })
    .andWhere("event_type IN (:...types)", { types: [...TRIAL_LIFECYCLE_EVENT_TYPES] })
    .andWhere("payload->>'logtoSub' = :sub", { sub: logtoSub })
    .andWhere("payload->>'productCode' = :productCode", { productCode })
    .execute();

  const jobs = await manager
    .createQueryBuilder()
    .update(TrialCleanupJobEntity)
    .set({ status: "canceled", lastError: "canceled_by_paid_entitlement" })
    .where("status IN (:...st)", { st: ["pending", "failed", "processing"] })
    .andWhere("logto_sub = :sub", { sub: logtoSub })
    .andWhere("product_code = :productCode", { productCode })
    .execute();

  return { events: events.affected ?? 0, jobs: jobs.affected ?? 0 };
}

export async function hasActiveNonTrialPaidEntitlement(
  manager: EntityManager,
  input: {
    logtoSub: string;
    productCode: string;
    organizationId?: string | null;
    deploymentId?: string | null;
    asOf?: Date;
  },
): Promise<boolean> {
  const asOf = input.asOf ?? new Date();

  const userSubs = await manager.find(SubscriptionEntity, {
    where: {
      subjectKind: "USER",
      subjectId: input.logtoSub,
      productCode: input.productCode,
      status: "active",
    },
  });
  if (
    userSubs.some(
      (sub) =>
        (PAID_PLAN_CODES as readonly string[]).includes(sub.planCode) &&
        isActiveWindow(sub.startsAt, sub.endsAt, asOf),
    )
  ) {
    return true;
  }

  const userGrants = await manager.find(GrantEntity, {
    where: {
      subjectKind: "USER",
      subjectId: input.logtoSub,
      productCode: input.productCode,
      revoked: false,
    },
  });
  if (
    userGrants.some(
      (grant) =>
        grant.planCode != null &&
        (PAID_PLAN_CODES as readonly string[]).includes(grant.planCode) &&
        isActiveWindow(grant.startsAt, grant.endsAt, asOf),
    )
  ) {
    return true;
  }

  if (input.organizationId) {
    const org = await manager.findOne(SubscriptionEntity, {
      where: {
        subjectKind: "ORGANIZATION",
        subjectId: input.organizationId,
        productCode: input.productCode,
        planCode: "enterprise",
        status: "active",
      },
    });
    if (org && isActiveWindow(org.startsAt, org.endsAt, asOf)) {
      return true;
    }
  }

  if (input.deploymentId) {
    const license = await manager.findOne(LicenseEntity, {
      where: { deploymentId: input.deploymentId, active: true },
    });
    if (license) {
      const graceMs = (license.offlineGraceDays ?? 0) * DAY_MS;
      const expires = license.expiresAt ? new Date(license.expiresAt.getTime() + graceMs) : null;
      if (!expires || expires.getTime() > asOf.getTime()) {
        return true;
      }
    }
  }

  return false;
}
