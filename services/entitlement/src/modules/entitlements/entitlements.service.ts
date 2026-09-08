import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, type EntityManager, type Repository } from "typeorm";
import type {
  MeteringMode,
  PlanCode,
  QuotaMerge,
  QuotaPeriod,
  SubjectKind,
} from "../../common/constants";
import { EntitlementException } from "../../common/errors";
import {
  applyGaugeDelta,
  assertMeteringMode,
  bigintToNumber,
  parseNonNegativeInt,
  remainingOf,
} from "../../common/quota-math";
import { ConsumeIdempotencyEntity } from "../../database/entities/consume-idempotency.entity";
import { FeatureEntity } from "../../database/entities/feature.entity";
import { GrantEntity } from "../../database/entities/grant.entity";
import { LicenseEntity } from "../../database/entities/license.entity";
import { OrganizationSeatEntity } from "../../database/entities/organization-seat.entity";
import { PlanEntity } from "../../database/entities/plan.entity";
import { PlanFeatureEntity } from "../../database/entities/plan-feature.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { ResourceAllocationEntity } from "../../database/entities/resource-allocation.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { TrialRedemptionEntity } from "../../database/entities/trial-redemption.entity";
import { UsageCounterEntity } from "../../database/entities/usage-counter.entity";
import {
  type ActiveSource,
  type CheckItem,
  type CheckResultItem,
  type EntitlementSnapshotDto,
  isActiveWindow,
  mergeFeatureMaps,
  type PlanFeatureDef,
  periodKeyFor,
  pickEffectivePlan,
  type ResolveContext,
  type AllocationMutationResult,
} from "./resolution";

@Injectable()
export class EntitlementsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
    @InjectRepository(GrantEntity)
    private readonly grants: Repository<GrantEntity>,
    @InjectRepository(PlanEntity)
    private readonly plans: Repository<PlanEntity>,
    @InjectRepository(PlanFeatureEntity)
    private readonly planFeatures: Repository<PlanFeatureEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(FeatureEntity)
    private readonly features: Repository<FeatureEntity>,
    @InjectRepository(UsageCounterEntity)
    private readonly usage: Repository<UsageCounterEntity>,
    @InjectRepository(OrganizationSeatEntity)
    private readonly seats: Repository<OrganizationSeatEntity>,
    @InjectRepository(LicenseEntity)
    private readonly licenses: Repository<LicenseEntity>,
    @InjectRepository(ConsumeIdempotencyEntity)
    private readonly idempotency: Repository<ConsumeIdempotencyEntity>,
  ) {}

  async resolve(ctx: ResolveContext): Promise<EntitlementSnapshotDto> {
    const asOf = ctx.asOf ?? new Date();
    const product = await this.products.findOne({ where: { code: ctx.productCode, active: true } });
    if (!product) {
      throw new EntitlementException("NOT_FOUND", `Unknown product ${ctx.productCode}`, {
        productCode: ctx.productCode,
      });
    }

    const sources = await this.collectSources(ctx, asOf);
    const planCodes = [
      ...new Set(sources.map((s) => s.planCode).filter((p): p is PlanCode => Boolean(p))),
    ];
    const planFeatureMap = await this.loadPlanFeatures(ctx.productCode, planCodes);
    const catalogQuotas = await this.loadCatalogQuotas(ctx.productCode);
    const merged = mergeFeatureMaps(sources, planFeatureMap, catalogQuotas);

    const usageRows = await this.usage.find({
      where: {
        subjectKind: ctx.subjectKind,
        subjectId: ctx.subjectId,
        productCode: ctx.productCode,
      },
    });
    const usageByFeature = new Map(usageRows.map((u) => [`${u.featureCode}:${u.periodKey}`, u]));

    const quotas: EntitlementSnapshotDto["quotas"] = {};
    for (const [code, q] of Object.entries(merged.quotas)) {
      const pk = periodKeyFor(q.period, asOf);
      const row = usageByFeature.get(`${code}:${pk}`);
      const used = row ? Number(row.used) : 0;
      const limit = q.limit;
      quotas[code] = {
        limit,
        used,
        remaining: remainingOf(limit, used),
        period: q.period,
        meteringMode: q.meteringMode,
        sources: q.sources,
      };
    }

    const trialSub = sources.find((s) => s.kind === "subscription" && s.planCode === "trial");
    const trialConsumed = await this.subscriptions.exists({
      where: {
        subjectKind: "USER",
        subjectId: ctx.subjectId,
        productCode: ctx.productCode,
        planCode: "trial",
        source: "trial",
      },
    });
    const trialRedemption = await this.dataSource.getRepository(TrialRedemptionEntity).findOne({
      where: { logtoSub: ctx.subjectId, productCode: ctx.productCode },
    });

    return {
      productCode: ctx.productCode,
      subjectKind: ctx.subjectKind,
      subjectId: ctx.subjectId,
      organizationId: ctx.organizationId ?? null,
      effectivePlan: pickEffectivePlan(sources.map((s) => s.planCode)),
      trial: {
        active: Boolean(trialSub && isActiveWindow(trialSub.startsAt, trialSub.endsAt, asOf)),
        endsAt: trialSub?.endsAt?.toISOString() ?? null,
        consumed: trialConsumed,
        eligible: product.trialPolicy === "standard_7d" && !trialConsumed,
        trialRedemptionId: trialRedemption?.id ?? null,
      },
      sellable: product.sellable,
      features: merged.features,
      quotas,
      asOf: asOf.toISOString(),
    };
  }

  async check(ctx: ResolveContext, items: CheckItem[]): Promise<CheckResultItem[]> {
    const snapshot = await this.resolve(ctx);
    const denialReason = (): string => {
      if (snapshot.trial.consumed && !snapshot.trial.active && snapshot.effectivePlan === "none") {
        return "ENTITLEMENT_TRIAL_EXPIRED";
      }
      if (snapshot.effectivePlan === "none") return "ENTITLEMENT_REQUIRED";
      return "ENTITLEMENT_FEATURE_REQUIRED";
    };
    return items.map((item) => {
      const feature = snapshot.features[item.featureCode];
      const quota = snapshot.quotas[item.featureCode];
      if (quota) {
        const need = item.need ?? 1;
        const remaining = quota.remaining;
        const allowed = remaining == null || remaining >= need;
        return {
          featureCode: item.featureCode,
          allowed,
          remaining,
          reason: allowed ? undefined : "ENTITLEMENT_QUOTA_EXCEEDED",
        };
      }
      if (!feature) {
        return {
          featureCode: item.featureCode,
          allowed: false,
          reason: denialReason(),
        };
      }
      return {
        featureCode: item.featureCode,
        allowed: feature.allowed,
        reason: feature.allowed ? undefined : (feature.reason ?? denialReason()),
      };
    });
  }

  async consume(input: {
    ctx: ResolveContext;
    featureCode: string;
    amount: number;
    idempotencyKey?: string;
  }): Promise<{
    featureCode: string;
    consumed: number;
    used: number;
    remaining: number | null;
    limit: number | null;
  }> {
    if (input.amount <= 0) {
      throw new EntitlementException("VALIDATION_ERROR", "amount must be positive");
    }

    type ConsumeResponse = {
      featureCode: string;
      consumed: number;
      used: number;
      remaining: number | null;
      limit: number | null;
    };

    if (input.idempotencyKey) {
      const existing = await this.idempotency.findOne({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return existing.response as ConsumeResponse;
    }

    const snapshot = await this.resolve(input.ctx);
    const quota = snapshot.quotas[input.featureCode];
    if (!quota) {
      throw new EntitlementException(
        "ENTITLEMENT_FEATURE_REQUIRED",
        `No quota entitlement for ${input.featureCode}`,
        { productCode: input.ctx.productCode, featureCode: input.featureCode },
      );
    }
    assertMeteringMode(quota.meteringMode, "counter", input.featureCode);
    if (quota.remaining != null && quota.remaining < input.amount) {
      throw new EntitlementException("ENTITLEMENT_QUOTA_EXCEEDED", "Quota exceeded", {
        productCode: input.ctx.productCode,
        featureCode: input.featureCode,
        details: { remaining: quota.remaining, need: input.amount },
      });
    }

    const asOf = input.ctx.asOf ?? new Date();
    const pk = periodKeyFor(quota.period, asOf);

    try {
      return await this.dataSource.transaction(async (manager) => {
        if (input.idempotencyKey) {
          const existing = await manager.findOne(ConsumeIdempotencyEntity, {
            where: { idempotencyKey: input.idempotencyKey },
            lock: { mode: "pessimistic_write" },
          });
          if (existing) return existing.response as ConsumeResponse;
        }

        let row = await manager.findOne(UsageCounterEntity, {
          where: {
            subjectKind: input.ctx.subjectKind,
            subjectId: input.ctx.subjectId,
            productCode: input.ctx.productCode,
            featureCode: input.featureCode,
            periodKey: pk,
          },
          lock: { mode: "pessimistic_write" },
        });
        if (!row) {
          row = await this.lockOrCreateUsageCounter(manager, {
            subjectKind: input.ctx.subjectKind,
            subjectId: input.ctx.subjectId,
            productCode: input.ctx.productCode,
            featureCode: input.featureCode,
            periodKey: pk,
            period: quota.period,
            limitValue: quota.limit,
          });
        }

        const used = Number(row.used);
        const limit = quota.limit;
        if (limit != null && used + input.amount > limit) {
          throw new EntitlementException("ENTITLEMENT_QUOTA_EXCEEDED", "Quota exceeded", {
            productCode: input.ctx.productCode,
            featureCode: input.featureCode,
          });
        }
        row.used = String(used + input.amount);
        row.limitValue = limit == null ? null : String(limit);
        await manager.save(row);

        const response: ConsumeResponse = {
          featureCode: input.featureCode,
          consumed: input.amount,
          used: used + input.amount,
          remaining: limit == null ? null : limit - (used + input.amount),
          limit,
        };

        if (input.idempotencyKey) {
          await manager.save(
            manager.create(ConsumeIdempotencyEntity, {
              idempotencyKey: input.idempotencyKey,
              response,
            }),
          );
        }
        return response;
      });
    } catch (err) {
      if (input.idempotencyKey) {
        const again = await this.idempotency.findOne({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (again) return again.response as ConsumeResponse;
      }
      throw err;
    }
  }

  async allocate(input: {
    ctx: ResolveContext;
    featureCode: string;
    resourceId: string;
    amount: number | string;
    ownerKind?: string | null;
    ownerId?: string | null;
    source?: string | null;
    sourceRef?: string | null;
    idempotencyKey?: string;
  }): Promise<AllocationMutationResult> {
    return this.mutateGauge({
      ...input,
      nextAmount: parseNonNegativeInt(input.amount),
      idempotencyPrefix: "alloc:",
    });
  }

  async release(input: {
    ctx: ResolveContext;
    featureCode: string;
    resourceId: string;
    idempotencyKey?: string;
  }): Promise<AllocationMutationResult> {
    return this.mutateGauge({
      ...input,
      nextAmount: 0n,
      idempotencyPrefix: "rel:",
    });
  }

  async reconcileGaugeUsage(
    filter: {
      subjectKind?: SubjectKind;
      subjectId?: string;
      productCode?: string;
      featureCode?: string;
    } = {},
  ): Promise<{
    rebuilt: number;
    items: Array<{
      subjectKind: SubjectKind;
      subjectId: string;
      productCode: string;
      featureCode: string;
      periodKey: string;
      used: number;
      allocationCount: number;
    }>;
  }> {
    const gaugeFeatures = await this.loadGaugeFeatures(filter.productCode, filter.featureCode);
    if (gaugeFeatures.length === 0) return { rebuilt: 0, items: [] };

    return this.dataSource.transaction(async (manager) => {
      const items: Array<{
        subjectKind: SubjectKind;
        subjectId: string;
        productCode: string;
        featureCode: string;
        periodKey: string;
        used: number;
        allocationCount: number;
      }> = [];

      const asOf = new Date();
      for (const feature of gaugeFeatures) {
        const period = feature.quotaPeriod ?? "lifetime";
        const periodKey = periodKeyFor(period, asOf);
        const allocQb = manager
          .createQueryBuilder(ResourceAllocationEntity, "a")
          .select("a.subject_kind", "subjectKind")
          .addSelect("a.subject_id", "subjectId")
          .addSelect("a.product_code", "productCode")
          .addSelect("a.feature_code", "featureCode")
          .addSelect("COUNT(*)::int", "allocationCount")
          .addSelect("COALESCE(SUM(a.amount), 0)", "used")
          .where("a.product_code = :productCode", { productCode: feature.productCode })
          .andWhere("a.feature_code = :featureCode", { featureCode: feature.code })
          .groupBy("a.subject_kind")
          .addGroupBy("a.subject_id")
          .addGroupBy("a.product_code")
          .addGroupBy("a.feature_code");
        if (filter.subjectKind) {
          allocQb.andWhere("a.subject_kind = :subjectKind", { subjectKind: filter.subjectKind });
        }
        if (filter.subjectId) {
          allocQb.andWhere("a.subject_id = :subjectId", { subjectId: filter.subjectId });
        }
        const sums = await allocQb.getRawMany<{
          subjectKind: SubjectKind;
          subjectId: string;
          productCode: string;
          featureCode: string;
          allocationCount: number | string;
          used: string;
        }>();

        const seen = new Set<string>();
        for (const row of sums) {
          const used = parseNonNegativeInt(String(row.used), "used");
          const usage = await this.lockOrCreateUsageCounter(manager, {
            subjectKind: row.subjectKind,
            subjectId: row.subjectId,
            productCode: row.productCode,
            featureCode: row.featureCode,
            periodKey,
            period,
            limitValue: null,
          });
          usage.used = String(used);
          await manager.save(usage);
          const key = `${row.subjectKind}:${row.subjectId}:${row.productCode}:${row.featureCode}:${periodKey}`;
          seen.add(key);
          items.push({
            subjectKind: row.subjectKind,
            subjectId: row.subjectId,
            productCode: row.productCode,
            featureCode: row.featureCode,
            periodKey,
            used: bigintToNumber(used),
            allocationCount: Number(row.allocationCount),
          });
        }

        const usageQb = manager
          .createQueryBuilder(UsageCounterEntity, "u")
          .where("u.product_code = :productCode", { productCode: feature.productCode })
          .andWhere("u.feature_code = :featureCode", { featureCode: feature.code })
          .andWhere("u.period_key = :periodKey", { periodKey });
        if (filter.subjectKind) {
          usageQb.andWhere("u.subject_kind = :subjectKind", { subjectKind: filter.subjectKind });
        }
        if (filter.subjectId) {
          usageQb.andWhere("u.subject_id = :subjectId", { subjectId: filter.subjectId });
        }
        const usageRows = await usageQb.getMany();
        for (const usage of usageRows) {
          const key = `${usage.subjectKind}:${usage.subjectId}:${usage.productCode}:${usage.featureCode}:${usage.periodKey}`;
          if (seen.has(key)) continue;
          usage.used = "0";
          await manager.save(usage);
          items.push({
            subjectKind: usage.subjectKind,
            subjectId: usage.subjectId,
            productCode: usage.productCode,
            featureCode: usage.featureCode,
            periodKey: usage.periodKey,
            used: 0,
            allocationCount: 0,
          });
        }
      }

      return { rebuilt: items.length, items };
    });
  }

  async assertSeatAvailable(
    organizationId: string,
    productCode: string,
  ): Promise<OrganizationSeatEntity> {
    const seat = await this.seats.findOne({ where: { organizationId, productCode } });
    if (!seat) {
      throw new EntitlementException("ENTITLEMENT_REQUIRED", "Organization has no seat pool", {
        productCode,
        details: { organizationId },
      });
    }
    if (seat.seatUsed >= seat.seatLimit) {
      throw new EntitlementException("ENTITLEMENT_SEAT_EXHAUSTED", "Organization seats exhausted", {
        productCode,
        details: { organizationId, seatLimit: seat.seatLimit, seatUsed: seat.seatUsed },
      });
    }
    return seat;
  }

  async occupySeat(organizationId: string, productCode: string): Promise<OrganizationSeatEntity> {
    return this.dataSource.transaction(async (manager) => {
      const seat = await manager.findOne(OrganizationSeatEntity, {
        where: { organizationId, productCode },
        lock: { mode: "pessimistic_write" },
      });
      if (!seat) {
        throw new EntitlementException("ENTITLEMENT_REQUIRED", "Organization has no seat pool", {
          productCode,
        });
      }
      if (seat.seatUsed >= seat.seatLimit) {
        throw new EntitlementException(
          "ENTITLEMENT_SEAT_EXHAUSTED",
          "Organization seats exhausted",
          {
            productCode,
          },
        );
      }
      seat.seatUsed += 1;
      return manager.save(seat);
    });
  }

  private async collectSources(ctx: ResolveContext, asOf: Date): Promise<ActiveSource[]> {
    const subjectFilters: Array<{ subjectKind: SubjectKind; subjectId: string }> = [
      { subjectKind: ctx.subjectKind, subjectId: ctx.subjectId },
    ];
    if (ctx.organizationId) {
      subjectFilters.push({ subjectKind: "ORGANIZATION", subjectId: ctx.organizationId });
    }
    if (ctx.deploymentId) {
      subjectFilters.push({ subjectKind: "DEPLOYMENT", subjectId: ctx.deploymentId });
    }

    const subs = await this.subscriptions.find({
      where: subjectFilters.map((f) => ({
        ...f,
        productCode: ctx.productCode,
        status: "active" as const,
      })),
    });
    const grantRows = await this.grants.find({
      where: subjectFilters.map((f) => ({
        ...f,
        productCode: ctx.productCode,
        revoked: false,
      })),
    });

    const sources: ActiveSource[] = [];
    for (const s of subs) {
      if (!isActiveWindow(s.startsAt, s.endsAt, asOf)) continue;
      sources.push({
        id: s.id,
        kind: "subscription",
        planCode: s.planCode,
        source: s.source,
        sourceRef: s.sourceRef,
        features: {},
        startsAt: s.startsAt,
        endsAt: s.endsAt,
      });
    }
    for (const g of grantRows) {
      if (!isActiveWindow(g.startsAt, g.endsAt, asOf)) continue;
      sources.push({
        id: g.id,
        kind: "grant",
        planCode: g.planCode,
        source: g.source,
        sourceRef: g.sourceRef,
        features: g.features ?? {},
        startsAt: g.startsAt,
        endsAt: g.endsAt,
      });
    }

    if (ctx.deploymentId) {
      const lic = await this.licenses.findOne({
        where: { deploymentId: ctx.deploymentId, active: true },
      });
      if (lic) {
        const graceMs = (lic.offlineGraceDays ?? 0) * 24 * 60 * 60 * 1000;
        const graceEndsAt = lic.expiresAt ? new Date(lic.expiresAt.getTime() + graceMs) : null;
        if (graceEndsAt && graceEndsAt.getTime() < asOf.getTime()) {
          // expired beyond grace — do not inject (products map to ENTITLEMENT_LICENSE_EXPIRED)
        } else {
          const payload = lic.payload as {
            features?: Record<string, Record<string, boolean | number>>;
            products?: string[];
          };
          const productFeatures = payload.features?.[ctx.productCode] ?? {};
          const features: ActiveSource["features"] = {};
          for (const [code, val] of Object.entries(productFeatures)) {
            if (typeof val === "boolean") {
              features[code] = { effect: val ? "allow" : "deny" };
            } else if (typeof val === "number") {
              features[code] = { effect: "allow", limitValue: val };
            }
          }
          sources.push({
            id: lic.id,
            kind: "grant",
            planCode: "enterprise",
            source: "license",
            sourceRef: lic.licenseId,
            features,
            startsAt: lic.createdAt,
            // Window includes offline grace so resolution stays active through grace period
            endsAt: graceEndsAt,
          });
        }
      }
    }

    return sources;
  }

  private async mutateGauge(input: {
    ctx: ResolveContext;
    featureCode: string;
    resourceId: string;
    nextAmount: bigint;
    ownerKind?: string | null;
    ownerId?: string | null;
    source?: string | null;
    sourceRef?: string | null;
    idempotencyKey?: string;
    idempotencyPrefix: string;
  }): Promise<AllocationMutationResult> {
    const resourceId = input.resourceId.trim();
    if (!resourceId) {
      throw new EntitlementException("VALIDATION_ERROR", "resourceId is required");
    }
    const storedKey = input.idempotencyKey
      ? `${input.idempotencyPrefix}${input.idempotencyKey}`
      : undefined;
    if (storedKey) {
      const existing = await this.idempotency.findOne({ where: { idempotencyKey: storedKey } });
      if (existing) return existing.response as unknown as AllocationMutationResult;
    }

    const snapshot = await this.resolve(input.ctx);
    const quota = snapshot.quotas[input.featureCode];
    if (!quota) {
      throw new EntitlementException(
        "ENTITLEMENT_FEATURE_REQUIRED",
        `No quota entitlement for ${input.featureCode}`,
        { productCode: input.ctx.productCode, featureCode: input.featureCode },
      );
    }
    assertMeteringMode(quota.meteringMode, "gauge", input.featureCode);

    const asOf = input.ctx.asOf ?? new Date();
    const pk = periodKeyFor(quota.period, asOf);
    const limit = quota.limit == null ? null : BigInt(quota.limit);

    try {
      return await this.dataSource.transaction(async (manager) => {
        if (storedKey) {
          const existing = await manager.findOne(ConsumeIdempotencyEntity, {
            where: { idempotencyKey: storedKey },
            lock: { mode: "pessimistic_write" },
          });
          if (existing) return existing.response as unknown as AllocationMutationResult;
        }

        const usage = await this.lockOrCreateUsageCounter(manager, {
          subjectKind: input.ctx.subjectKind,
          subjectId: input.ctx.subjectId,
          productCode: input.ctx.productCode,
          featureCode: input.featureCode,
          periodKey: pk,
          period: quota.period,
          limitValue: quota.limit,
        });

        const allocation = await manager.findOne(ResourceAllocationEntity, {
          where: {
            subjectKind: input.ctx.subjectKind,
            subjectId: input.ctx.subjectId,
            productCode: input.ctx.productCode,
            featureCode: input.featureCode,
            resourceId,
          },
          lock: { mode: "pessimistic_write" },
        });
        const previousAmount = allocation ? parseNonNegativeInt(allocation.amount, "amount") : 0n;
        const next = applyGaugeDelta({
          currentUsed: parseNonNegativeInt(usage.used, "used"),
          previousAmount,
          nextAmount: input.nextAmount,
          limit,
        });
        const usedNumber = bigintToNumber(next.used);
        const amountNumber = bigintToNumber(input.nextAmount);
        const response: AllocationMutationResult = {
          featureCode: input.featureCode,
          resourceId,
          amount: amountNumber,
          previousAmount: bigintToNumber(previousAmount),
          used: usedNumber,
          remaining: remainingOf(quota.limit, usedNumber),
          limit: quota.limit,
          meteringMode: "gauge",
          unchanged: next.unchanged,
          released: input.nextAmount === 0n,
        };

        if (!next.unchanged) {
          usage.used = String(next.used);
          usage.limitValue = quota.limit == null ? null : String(quota.limit);
          await manager.save(usage);
          if (input.nextAmount === 0n) {
            if (allocation) await manager.remove(allocation);
          } else if (allocation) {
            allocation.amount = String(input.nextAmount);
            allocation.ownerKind = input.ownerKind ?? allocation.ownerKind;
            allocation.ownerId = input.ownerId ?? allocation.ownerId;
            allocation.source = input.source ?? allocation.source;
            allocation.sourceRef = input.sourceRef ?? allocation.sourceRef;
            await manager.save(allocation);
          } else {
            await manager.save(
              manager.create(ResourceAllocationEntity, {
                subjectKind: input.ctx.subjectKind,
                subjectId: input.ctx.subjectId,
                productCode: input.ctx.productCode,
                featureCode: input.featureCode,
                resourceId,
                amount: String(input.nextAmount),
                ownerKind: input.ownerKind ?? null,
                ownerId: input.ownerId ?? null,
                source: input.source ?? null,
                sourceRef: input.sourceRef ?? null,
              }),
            );
          }
        } else {
          usage.limitValue = quota.limit == null ? null : String(quota.limit);
          await manager.save(usage);
        }

        if (storedKey) {
          await manager.save(
            manager.create(ConsumeIdempotencyEntity, {
              idempotencyKey: storedKey,
              response: { ...response },
            }),
          );
        }
        return response;
      });
    } catch (err) {
      if (storedKey) {
        const again = await this.idempotency.findOne({ where: { idempotencyKey: storedKey } });
        if (again) return again.response as unknown as AllocationMutationResult;
      }
      throw err;
    }
  }

  private async lockOrCreateUsageCounter(
    manager: EntityManager,
    input: {
      subjectKind: SubjectKind;
      subjectId: string;
      productCode: string;
      featureCode: string;
      periodKey: string;
      period: QuotaPeriod;
      limitValue: number | null;
    },
  ): Promise<UsageCounterEntity> {
    await manager.query(
      `
      INSERT INTO usage_counters (
        id, subject_kind, subject_id, product_code, feature_code, period_key, period,
        used, limit_value, version, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, '0', $7, 1, now(), now()
      )
      ON CONFLICT (subject_kind, subject_id, product_code, feature_code, period_key)
      DO NOTHING
      `,
      [
        input.subjectKind,
        input.subjectId,
        input.productCode,
        input.featureCode,
        input.periodKey,
        input.period,
        input.limitValue == null ? null : String(input.limitValue),
      ],
    );
    return manager.findOneOrFail(UsageCounterEntity, {
      where: {
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        productCode: input.productCode,
        featureCode: input.featureCode,
        periodKey: input.periodKey,
      },
      lock: { mode: "pessimistic_write" },
    });
  }

  private async loadGaugeFeatures(productCode?: string, featureCode?: string) {
    const products = productCode
      ? await this.products.find({ where: { code: productCode } })
      : await this.products.find();
    const out: Array<{ productCode: string; code: string; quotaPeriod: QuotaPeriod | null }> = [];
    for (const product of products) {
      const rows = await this.features.find({
        where: {
          productId: product.id,
          kind: "quota",
          meteringMode: "gauge",
          ...(featureCode ? { code: featureCode } : {}),
        },
      });
      for (const row of rows) {
        out.push({ productCode: product.code, code: row.code, quotaPeriod: row.quotaPeriod });
      }
    }
    return out;
  }

  private async loadCatalogQuotas(
    productCode: string,
  ): Promise<Map<string, { period: QuotaPeriod; merge: QuotaMerge; meteringMode: MeteringMode }>> {
    const product = await this.products.findOne({ where: { code: productCode } });
    if (!product) return new Map();
    const rows = await this.features.find({ where: { productId: product.id, kind: "quota" } });
    return new Map(
      rows.map((row) => [
        row.code,
        {
          period: row.quotaPeriod ?? "lifetime",
          merge: row.quotaMerge ?? "max",
          meteringMode: row.meteringMode ?? "counter",
        },
      ]),
    );
  }

  private async loadPlanFeatures(
    productCode: string,
    planCodes: PlanCode[],
  ): Promise<Map<PlanCode, PlanFeatureDef[]>> {
    const map = new Map<PlanCode, PlanFeatureDef[]>();
    if (planCodes.length === 0) return map;
    const product = await this.products.findOne({ where: { code: productCode } });
    if (!product) return map;
    const plans = await this.plans.find({
      where: { productId: product.id, code: In(planCodes) },
    });
    if (plans.length === 0) return map;
    const pfs = await this.planFeatures.find({
      where: { planId: In(plans.map((p) => p.id)) },
      relations: { feature: true },
    });
    const planById = new Map(plans.map((p) => [p.id, p]));
    for (const pf of pfs) {
      const plan = planById.get(pf.planId);
      if (!plan) continue;
      const list = map.get(plan.code) ?? [];
      list.push({
        featureCode: pf.feature.code,
        kind: pf.feature.kind,
        effect: pf.effect,
        limitValue: pf.limitValue == null ? null : Number(pf.limitValue),
        quotaPeriod: pf.feature.quotaPeriod,
        quotaMerge: pf.quotaMerge ?? pf.feature.quotaMerge ?? "max",
      });
      map.set(plan.code, list);
    }
    return map;
  }
}
