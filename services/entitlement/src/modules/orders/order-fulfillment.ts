import { In, type EntityManager } from "typeorm";
import {
  isBillingInterval,
  paidSubscriptionEndsAt,
  type BillingInterval,
} from "../../common/catalog-pricing";
import type { PlanCode } from "../../common/constants";
import { EntitlementException } from "../../common/errors";
import { isPaidLikeOrderStatus } from "../../common/payment-providers";
import { assertTrialPlanAllowed } from "../../common/trial-policy";
import { getQuotaPack } from "../../common/voice-packs";
import { BillingProfileEntity } from "../../database/entities/billing-profile.entity";
import { BundleEntity } from "../../database/entities/bundle.entity";
import { GrantEntity } from "../../database/entities/grant.entity";
import { OrderEntity } from "../../database/entities/order.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { acquireTrialLifecycleLock, cancelTrialLifecycle } from "../trials/trial-lifecycle";

export async function fulfillPaidOrderTx(
  manager: EntityManager,
  orderId: string,
  providerRef: string,
): Promise<OrderEntity | null> {
  const locked = await manager.findOne(OrderEntity, {
    where: { id: orderId },
    lock: { mode: "pessimistic_write" },
  });
  if (!locked) return null;
  if (isPaidLikeOrderStatus(locked.status)) return locked;

  locked.status = "paid";
  locked.providerRef = providerRef;
  await manager.save(locked);

  if (locked.metadata?.kind === "quota_pack") {
    const packSku = String(locked.metadata.packSku ?? "");
    const pack = getQuotaPack(packSku);
    if (!pack) {
      throw new EntitlementException("VALIDATION_ERROR", `Unknown pack SKU ${packSku}`);
    }
    const startsAt = new Date();
    const endsAt =
      pack.validDays != null
        ? new Date(startsAt.getTime() + pack.validDays * 24 * 60 * 60 * 1000)
        : null;
    await manager.save(
      manager.create(GrantEntity, {
        subjectKind: locked.subjectKind,
        subjectId: locked.subjectId,
        productCode: pack.productCode,
        planCode: null,
        features: {
          [pack.featureCode]: { effect: "allow", limitValue: pack.seconds },
          "ai.voice": { effect: "allow" },
        },
        startsAt,
        endsAt,
        source: "order",
        sourceRef: locked.id,
        revoked: false,
      }),
    );
  } else {
    await writeSubscriptionGrants(manager, locked);
  }

  locked.status = "fulfilled";
  await manager.save(locked);
  await lockBillingProfile(manager, locked);
  await manager.save(
    manager.create(OutboxEventEntity, {
      eventType: "order.fulfilled",
      dedupeKey: `order.fulfilled:${locked.id}`,
      payload: {
        orderId: locked.id,
        subjectId: locked.subjectId,
        productCode: locked.productCode,
        planCode: locked.planCode,
      },
    }),
  );
  return locked;
}

async function writeSubscriptionGrants(manager: EntityManager, locked: OrderEntity): Promise<void> {
  const now = new Date();
  const interval: BillingInterval = isBillingInterval(locked.interval) ? locked.interval : "month";
  const items: Array<{ productCode: string; planCode: PlanCode }> = [];
  if (locked.bundleSku) {
    const bundle = await manager.findOne(BundleEntity, {
      where: { sku: locked.bundleSku },
      relations: { items: true },
    });
    for (const item of bundle?.items ?? []) {
      items.push({ productCode: item.productCode, planCode: item.planCode });
    }
  } else if (locked.productCode && locked.planCode) {
    items.push({ productCode: locked.productCode, planCode: locked.planCode });
  }

  await assertDeclaredBundleProducts(
    manager,
    items.map((item) => item.productCode),
  );
  const products = manager.getRepository(ProductEntity);
  for (const item of items) {
    await assertTrialPlanAllowed(products, item.productCode, item.planCode);
  }

  for (const item of items) {
    if (locked.subjectKind === "USER" && item.planCode !== "trial") {
      await acquireTrialLifecycleLock(manager, locked.subjectId, item.productCode);
    }
    const existing = await manager.findOne(SubscriptionEntity, {
      where: {
        subjectKind: locked.subjectKind,
        subjectId: locked.subjectId,
        productCode: item.productCode,
        planCode: item.planCode,
        status: "active",
      },
    });
    const endsAt = paidSubscriptionEndsAt(now, interval, existing?.endsAt ?? null);
    let sub: SubscriptionEntity;
    if (existing) {
      existing.endsAt = endsAt;
      existing.source = "order";
      existing.sourceRef = locked.id;
      sub = await manager.save(existing);
      const existingGrant = await manager.findOne(GrantEntity, {
        where: {
          subjectKind: locked.subjectKind,
          subjectId: locked.subjectId,
          productCode: item.productCode,
          source: "order",
          sourceRef: existing.id,
          revoked: false,
        },
      });
      if (existingGrant) {
        existingGrant.endsAt = endsAt;
        await manager.save(existingGrant);
      } else {
        await manager.save(
          manager.create(GrantEntity, {
            subjectKind: locked.subjectKind,
            subjectId: locked.subjectId,
            productCode: item.productCode,
            planCode: item.planCode,
            features: {},
            startsAt: existing.startsAt,
            endsAt,
            source: "order",
            sourceRef: sub.id,
            revoked: false,
          }),
        );
      }
    } else {
      sub = await manager.save(
        manager.create(SubscriptionEntity, {
          subjectKind: locked.subjectKind,
          subjectId: locked.subjectId,
          productCode: item.productCode,
          planCode: item.planCode,
          status: "active",
          startsAt: now,
          endsAt,
          source: "order",
          sourceRef: locked.id,
          organizationId: null,
        }),
      );
      await manager.save(
        manager.create(GrantEntity, {
          subjectKind: locked.subjectKind,
          subjectId: locked.subjectId,
          productCode: item.productCode,
          planCode: item.planCode,
          features: {},
          startsAt: now,
          endsAt,
          source: "order",
          sourceRef: sub.id,
          revoked: false,
        }),
      );
    }

    if (locked.subjectKind === "USER" && item.planCode !== "trial") {
      await cancelTrialLifecycle(manager, locked.subjectId, item.productCode);
    }
  }
}

export async function revokeOrderEntitlements(
  manager: EntityManager,
  order: OrderEntity,
  at: Date,
): Promise<void> {
  const subs = await manager.find(SubscriptionEntity, {
    where: { source: "order", sourceRef: order.id },
  });
  for (const sub of subs) {
    sub.status = "canceled";
    sub.canceledAt = at;
    await manager.save(sub);
    const grants = await manager.find(GrantEntity, {
      where: { source: "order", sourceRef: sub.id, revoked: false },
    });
    for (const grant of grants) {
      grant.revoked = true;
      grant.revokedAt = at;
      await manager.save(grant);
    }
  }
  const packGrants = await manager.find(GrantEntity, {
    where: { source: "order", sourceRef: order.id, revoked: false },
  });
  for (const grant of packGrants) {
    grant.revoked = true;
    grant.revokedAt = at;
    await manager.save(grant);
  }
}

async function lockBillingProfile(manager: EntityManager, order: OrderEntity): Promise<void> {
  const profile = await manager.findOne(BillingProfileEntity, {
    where: { subjectKind: order.subjectKind, subjectId: order.subjectId },
    lock: { mode: "pessimistic_write" },
  });
  if (!profile) return;
  profile.locked = true;
  profile.lockedAt = new Date();
  profile.lockedReason = `order:${order.id}`;
  await manager.save(profile);
}

async function assertDeclaredBundleProducts(
  manager: EntityManager,
  productCodes: string[],
): Promise<void> {
  const unique = [...new Set(productCodes.map((code) => code.trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new EntitlementException("VALIDATION_ERROR", "Order has no declared products");
  }
  const found = await manager.getRepository(ProductEntity).find({
    where: { code: In(unique), active: true },
  });
  const foundCodes = new Set(found.map((row) => row.code));
  const missing = unique.filter((code) => !foundCodes.has(code));
  if (missing.length > 0) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      `Bundle/order references undeclared products: ${missing.join(", ")}`,
    );
  }
}
