import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, type Repository } from "typeorm";
import type { PlanCode, SubjectKind } from "../../common/constants";
import { EntitlementException } from "../../common/errors";
import { ConsumeIdempotencyEntity } from "../../database/entities/consume-idempotency.entity";
import { FeatureEntity } from "../../database/entities/feature.entity";
import { GrantEntity } from "../../database/entities/grant.entity";
import { LicenseEntity } from "../../database/entities/license.entity";
import { OrganizationSeatEntity } from "../../database/entities/organization-seat.entity";
import { PlanEntity } from "../../database/entities/plan.entity";
import { PlanFeatureEntity } from "../../database/entities/plan-feature.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
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
    const merged = mergeFeatureMaps(sources, planFeatureMap);

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
        remaining: limit == null ? null : Math.max(0, limit - used),
        period: q.period,
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
      },
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
          try {
            row = await manager.save(
              manager.create(UsageCounterEntity, {
                subjectKind: input.ctx.subjectKind,
                subjectId: input.ctx.subjectId,
                productCode: input.ctx.productCode,
                featureCode: input.featureCode,
                periodKey: pk,
                period: quota.period,
                used: "0",
                limitValue: quota.limit == null ? null : String(quota.limit),
              }),
            );
          } catch {
            // Concurrent first insert — re-select under lock
            row = await manager.findOneOrFail(UsageCounterEntity, {
              where: {
                subjectKind: input.ctx.subjectKind,
                subjectId: input.ctx.subjectId,
                productCode: input.ctx.productCode,
                featureCode: input.featureCode,
                periodKey: pk,
              },
              lock: { mode: "pessimistic_write" },
            });
          }
          row = await manager.findOneOrFail(UsageCounterEntity, {
            where: { id: row.id },
            lock: { mode: "pessimistic_write" },
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
