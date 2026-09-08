import dataSource from "../src/database/data-source";
import {
  ConsumeIdempotencyEntity,
  FeatureEntity,
  GrantEntity,
  LicenseEntity,
  OrganizationSeatEntity,
  PlanEntity,
  PlanFeatureEntity,
  ProductEntity,
  SubscriptionEntity,
  UsageCounterEntity,
} from "../src/database/entities";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";

const describeDatabase = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("gauge allocation database integration", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const productCode = `gauge-${suffix}`;
  const subjectId = `user-${suffix}`;
  const otherSubject = `user-other-${suffix}`;
  const sameSubject = `user-same-${suffix}`;
  const featureGauge = "dashboard.count";
  const featureCounter = "sync.run.daily";
  const featureBytes = "storage.bytes";

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const products = dataSource.getRepository(ProductEntity);
    const product = await products.save(
      products.create({
        code: productCode,
        name: "Gauge Integration",
        active: true,
        trialPolicy: "standard_7d",
        sellable: true,
      }),
    );
    const features = dataSource.getRepository(FeatureEntity);
    const gauge = await features.save(
      features.create({
        productId: product.id,
        code: featureGauge,
        name: "Dashboard count",
        kind: "quota",
        quotaPeriod: "lifetime",
        quotaMerge: "max",
        meteringMode: "gauge",
      }),
    );
    const counter = await features.save(
      features.create({
        productId: product.id,
        code: featureCounter,
        name: "Daily sync runs",
        kind: "quota",
        quotaPeriod: "calendar_day",
        quotaMerge: "max",
        meteringMode: "counter",
      }),
    );
    const bytes = await features.save(
      features.create({
        productId: product.id,
        code: featureBytes,
        name: "Storage bytes",
        kind: "quota",
        quotaPeriod: "lifetime",
        quotaMerge: "max",
        meteringMode: "gauge",
      }),
    );
    const plans = dataSource.getRepository(PlanEntity);
    const pro = await plans.save(
      plans.create({
        productId: product.id,
        code: "pro",
        name: "Pro",
        rank: 2,
        active: true,
      }),
    );
    const planFeatures = dataSource.getRepository(PlanFeatureEntity);
    await planFeatures.save([
      planFeatures.create({
        planId: pro.id,
        featureId: gauge.id,
        effect: "allow",
        limitValue: "2",
      }),
      planFeatures.create({
        planId: pro.id,
        featureId: counter.id,
        effect: "allow",
        limitValue: "10",
      }),
      planFeatures.create({
        planId: pro.id,
        featureId: bytes.id,
        effect: "allow",
        limitValue: "1000",
      }),
    ]);
    const subscriptions = dataSource.getRepository(SubscriptionEntity);
    await subscriptions.save(
      subscriptions.create({
        subjectKind: "USER",
        subjectId,
        productCode,
        planCode: "pro",
        status: "active",
        startsAt: new Date("2020-01-01T00:00:00.000Z"),
        endsAt: null,
        source: "manual",
      }),
    );
    await subscriptions.save(
      subscriptions.create({
        subjectKind: "USER",
        subjectId: otherSubject,
        productCode,
        planCode: "pro",
        status: "active",
        startsAt: new Date("2020-01-01T00:00:00.000Z"),
        endsAt: null,
        source: "manual",
      }),
    );
    await subscriptions.save(
      subscriptions.create({
        subjectKind: "USER",
        subjectId: sameSubject,
        productCode,
        planCode: "pro",
        status: "active",
        startsAt: new Date("2020-01-01T00:00:00.000Z"),
        endsAt: null,
        source: "manual",
      }),
    );
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM resource_allocations WHERE product_code = $1`, [
      productCode,
    ]);
    await dataSource.query(`DELETE FROM usage_counters WHERE product_code = $1`, [productCode]);
    await dataSource.query(`DELETE FROM consume_idempotency WHERE idempotency_key LIKE $1`, [
      `%${suffix}%`,
    ]);
    await dataSource.query(`DELETE FROM subscriptions WHERE product_code = $1`, [productCode]);
    await dataSource.query(
      `DELETE FROM plan_features WHERE plan_id IN (SELECT id FROM plans WHERE product_id IN (SELECT id FROM products WHERE code = $1))`,
      [productCode],
    );
    await dataSource.query(
      `DELETE FROM plans WHERE product_id IN (SELECT id FROM products WHERE code = $1)`,
      [productCode],
    );
    await dataSource.query(
      `DELETE FROM features WHERE product_id IN (SELECT id FROM products WHERE code = $1)`,
      [productCode],
    );
    await dataSource.getRepository(ProductEntity).delete({ code: productCode });
    await dataSource.destroy();
  });

  function service() {
    return new EntitlementsService(
      dataSource,
      dataSource.getRepository(SubscriptionEntity),
      dataSource.getRepository(GrantEntity),
      dataSource.getRepository(PlanEntity),
      dataSource.getRepository(PlanFeatureEntity),
      dataSource.getRepository(ProductEntity),
      dataSource.getRepository(FeatureEntity),
      dataSource.getRepository(UsageCounterEntity),
      dataSource.getRepository(OrganizationSeatEntity),
      dataSource.getRepository(LicenseEntity),
      dataSource.getRepository(ConsumeIdempotencyEntity),
    );
  }

  function ctx(id = subjectId) {
    return {
      subjectKind: "USER" as const,
      subjectId: id,
      productCode,
    };
  }

  it("creates, updates, and releases an absolute resource amount", async () => {
    const entitlements = service();
    const created = await entitlements.allocate({
      ctx: ctx(),
      featureCode: featureGauge,
      resourceId: `dash-${suffix}-a`,
      amount: 1,
      source: "dataluminary",
    });
    expect(created).toMatchObject({
      amount: 1,
      previousAmount: 0,
      used: 1,
      remaining: 1,
      released: false,
    });
    const same = await entitlements.allocate({
      ctx: ctx(),
      featureCode: featureGauge,
      resourceId: `dash-${suffix}-a`,
      amount: 1,
    });
    expect(same.unchanged).toBe(true);
    expect(same.used).toBe(1);
    const updated = await entitlements.allocate({
      ctx: ctx(),
      featureCode: featureGauge,
      resourceId: `dash-${suffix}-a`,
      amount: 2,
    });
    expect(updated).toMatchObject({ amount: 2, previousAmount: 1, used: 2, remaining: 0 });
    const snapshot = await entitlements.resolve(ctx());
    expect(snapshot.quotas[featureGauge]).toMatchObject({
      used: 2,
      remaining: 0,
      meteringMode: "gauge",
    });
    const released = await entitlements.release({
      ctx: ctx(),
      featureCode: featureGauge,
      resourceId: `dash-${suffix}-a`,
    });
    expect(released).toMatchObject({ released: true, amount: 0, used: 0, remaining: 2 });
  });

  it("treats a second release as idempotent", async () => {
    const entitlements = service();
    const resourceId = `dash-${suffix}-release`;
    await entitlements.allocate({ ctx: ctx(), featureCode: featureGauge, resourceId, amount: 1 });
    const first = await entitlements.release({ ctx: ctx(), featureCode: featureGauge, resourceId });
    const second = await entitlements.release({
      ctx: ctx(),
      featureCode: featureGauge,
      resourceId,
    });
    expect(first.released).toBe(true);
    expect(second).toMatchObject({
      released: true,
      previousAmount: 0,
      used: first.used,
      unchanged: true,
    });
  });

  it("rejects an allocation that would exceed the current limit", async () => {
    const entitlements = service();
    await entitlements.allocate({
      ctx: ctx(),
      featureCode: featureGauge,
      resourceId: `dash-${suffix}-limit-1`,
      amount: 1,
    });
    await entitlements.allocate({
      ctx: ctx(),
      featureCode: featureGauge,
      resourceId: `dash-${suffix}-limit-2`,
      amount: 1,
    });
    await expect(
      entitlements.allocate({
        ctx: ctx(),
        featureCode: featureGauge,
        resourceId: `dash-${suffix}-limit-3`,
        amount: 1,
      }),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_QUOTA_EXCEEDED" });
    await entitlements.release({
      ctx: ctx(),
      featureCode: featureGauge,
      resourceId: `dash-${suffix}-limit-1`,
    });
    await entitlements.release({
      ctx: ctx(),
      featureCode: featureGauge,
      resourceId: `dash-${suffix}-limit-2`,
    });
  });

  it("serializes concurrent first allocations against the same quota", async () => {
    const entitlements = service();
    const results = await Promise.allSettled([
      entitlements.allocate({
        ctx: ctx(otherSubject),
        featureCode: featureGauge,
        resourceId: `dash-${suffix}-race-a`,
        amount: 1,
      }),
      entitlements.allocate({
        ctx: ctx(otherSubject),
        featureCode: featureGauge,
        resourceId: `dash-${suffix}-race-b`,
        amount: 1,
      }),
      entitlements.allocate({
        ctx: ctx(otherSubject),
        featureCode: featureGauge,
        resourceId: `dash-${suffix}-race-c`,
        amount: 1,
      }),
    ]);
    const fulfilled = results.filter((row) => row.status === "fulfilled");
    const rejected = results.filter((row) => row.status === "rejected");
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "ENTITLEMENT_QUOTA_EXCEEDED",
    });
    const sameResourceId = `dash-${suffix}-same`;
    const sameFirst = await Promise.all([
      entitlements.allocate({
        ctx: ctx(sameSubject),
        featureCode: featureGauge,
        resourceId: sameResourceId,
        amount: 1,
      }),
      entitlements.allocate({
        ctx: ctx(sameSubject),
        featureCode: featureGauge,
        resourceId: sameResourceId,
        amount: 1,
      }),
    ]);
    expect(sameFirst.every((row) => row.amount === 1)).toBe(true);
    expect(new Set(sameFirst.map((row) => row.used)).size).toBe(1);
    expect((await entitlements.resolve(ctx(sameSubject))).quotas[featureGauge]?.used).toBe(1);
    const snap = await entitlements.resolve(ctx(otherSubject));
    expect(snap.quotas[featureGauge]?.used).toBe(2);
  });

  it("keeps used after the limit is lowered and only allows shrinking", async () => {
    const entitlements = service();
    const resourceId = `obj-${suffix}-bytes`;
    await entitlements.allocate({
      ctx: ctx(),
      featureCode: featureBytes,
      resourceId,
      amount: 800,
    });
    const mapping = await dataSource.getRepository(PlanFeatureEntity).findOneOrFail({
      where: {
        featureId: (
          await dataSource.getRepository(FeatureEntity).findOneByOrFail({
            productId: (
              await dataSource.getRepository(ProductEntity).findOneByOrFail({ code: productCode })
            ).id,
            code: featureBytes,
          })
        ).id,
      },
    });
    mapping.limitValue = "500";
    await dataSource.getRepository(PlanFeatureEntity).save(mapping);
    const snap = await entitlements.resolve(ctx());
    expect(snap.quotas[featureBytes]).toMatchObject({ used: 800, remaining: 0, limit: 500 });
    await expect(
      entitlements.allocate({
        ctx: ctx(),
        featureCode: featureBytes,
        resourceId: `obj-${suffix}-bytes-2`,
        amount: 1,
      }),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_QUOTA_EXCEEDED" });
    const shrunk = await entitlements.allocate({
      ctx: ctx(),
      featureCode: featureBytes,
      resourceId,
      amount: 400,
    });
    expect(shrunk.used).toBe(400);
    expect(shrunk.remaining).toBe(100);
    mapping.limitValue = "1000";
    await dataSource.getRepository(PlanFeatureEntity).save(mapping);
    await entitlements.release({ ctx: ctx(), featureCode: featureBytes, resourceId });
  });

  it("rebuilds the gauge aggregate from allocations", async () => {
    const entitlements = service();
    const resourceId = `dash-${suffix}-recon`;
    await entitlements.allocate({ ctx: ctx(), featureCode: featureGauge, resourceId, amount: 1 });
    await dataSource.query(
      `UPDATE usage_counters SET used = '99' WHERE product_code = $1 AND feature_code = $2 AND subject_id = $3`,
      [productCode, featureGauge, subjectId],
    );
    const drifted = await entitlements.resolve(ctx());
    expect(drifted.quotas[featureGauge]?.used).toBe(99);
    const rebuilt = await entitlements.reconcileGaugeUsage({
      productCode,
      featureCode: featureGauge,
      subjectId,
      subjectKind: "USER",
    });
    expect(rebuilt.rebuilt).toBeGreaterThan(0);
    const snap = await entitlements.resolve(ctx());
    expect(snap.quotas[featureGauge]?.used).toBe(1);
    await entitlements.release({ ctx: ctx(), featureCode: featureGauge, resourceId });
    await entitlements.reconcileGaugeUsage({
      productCode,
      featureCode: featureGauge,
      subjectId,
      subjectKind: "USER",
    });
    expect((await entitlements.resolve(ctx())).quotas[featureGauge]?.used).toBe(0);
  });

  it("keeps counter consume behavior and rejects consume on gauges", async () => {
    const entitlements = service();
    const consumed = await entitlements.consume({
      ctx: ctx(),
      featureCode: featureCounter,
      amount: 3,
    });
    expect(consumed).toMatchObject({ consumed: 3, used: 3, remaining: 7 });
    const again = await entitlements.consume({
      ctx: ctx(),
      featureCode: featureCounter,
      amount: 1,
      idempotencyKey: `counter-${suffix}`,
    });
    const idempotent = await entitlements.consume({
      ctx: ctx(),
      featureCode: featureCounter,
      amount: 1,
      idempotencyKey: `counter-${suffix}`,
    });
    expect(idempotent).toEqual(again);
    await expect(
      entitlements.consume({ ctx: ctx(), featureCode: featureGauge, amount: 1 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      entitlements.allocate({
        ctx: ctx(),
        featureCode: featureCounter,
        resourceId: "run-1",
        amount: 1,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accounts bytes for a resource and ignores a caller-supplied subject in context", async () => {
    const entitlements = service();
    const mine = await entitlements.allocate({
      ctx: ctx(),
      featureCode: featureBytes,
      resourceId: `obj-${suffix}-trust`,
      amount: 128,
    });
    expect(mine.used).toBe(128);
    const other = await entitlements.resolve(ctx(otherSubject));
    expect(other.quotas[featureBytes]?.used ?? 0).toBe(0);
    expect(other.subjectId).toBe(otherSubject);
    await entitlements.release({
      ctx: ctx(),
      featureCode: featureBytes,
      resourceId: `obj-${suffix}-trust`,
    });
  });
});
