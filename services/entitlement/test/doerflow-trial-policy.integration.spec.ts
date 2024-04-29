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
  TrialRedemptionEntity,
  UsageCounterEntity,
} from "../src/database/entities";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import { TrialsService } from "../src/modules/trials/trials.service";

const describeDatabase = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("product trial policy database integration", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const disabledCode = `no-trial-${suffix}`;
  const standardCode = `standard-trial-${suffix}`;
  const disabledSubject = `disabled-user-${suffix}`;
  const standardSubject = `standard-user-${suffix}`;

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const products = dataSource.getRepository(ProductEntity);
    await products.save([
      products.create({
        code: disabledCode,
        name: "No Trial Integration Product",
        active: true,
        trialPolicy: "disabled",
      }),
      products.create({
        code: standardCode,
        name: "Standard Trial Integration Product",
        active: true,
        trialPolicy: "standard_7d",
      }),
    ]);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM outbox_events WHERE payload->>'productCode' IN ($1, $2)`, [
      disabledCode,
      standardCode,
    ]);
    for (const table of ["trial_redemptions", "grants", "subscriptions"]) {
      await dataSource.query(`DELETE FROM ${table} WHERE product_code IN ($1, $2)`, [
        disabledCode,
        standardCode,
      ]);
    }
    await dataSource
      .getRepository(ProductEntity)
      .delete([{ code: disabledCode }, { code: standardCode }]);
    await dataSource.destroy();
  });

  function services() {
    const products = dataSource.getRepository(ProductEntity);
    const subscriptions = dataSource.getRepository(SubscriptionEntity);
    const grants = dataSource.getRepository(GrantEntity);
    const licenses = dataSource.getRepository(LicenseEntity);
    return {
      trials: new TrialsService(
        dataSource,
        dataSource.getRepository(TrialRedemptionEntity),
        subscriptions,
        licenses,
        products,
        { record: jest.fn() } as never,
      ),
      entitlements: new EntitlementsService(
        dataSource,
        subscriptions,
        grants,
        dataSource.getRepository(PlanEntity),
        dataSource.getRepository(PlanFeatureEntity),
        products,
        dataSource.getRepository(FeatureEntity),
        dataSource.getRepository(UsageCounterEntity),
        dataSource.getRepository(OrganizationSeatEntity),
        licenses,
        dataSource.getRepository(ConsumeIdempotencyEntity),
      ),
    };
  }

  it("creates no rows or events and reports ineligible for disabled products", async () => {
    const { trials, entitlements } = services();

    await expect(
      trials.ensureTrial({
        logtoSub: disabledSubject,
        productCode: disabledCode,
        actor: disabledSubject,
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_TRIAL_DISABLED" });

    const [redemptions, subscriptions, grants, outbox] = await Promise.all([
      dataSource
        .getRepository(TrialRedemptionEntity)
        .count({ where: { logtoSub: disabledSubject, productCode: disabledCode } }),
      dataSource
        .getRepository(SubscriptionEntity)
        .count({ where: { subjectId: disabledSubject, productCode: disabledCode } }),
      dataSource
        .getRepository(GrantEntity)
        .count({ where: { subjectId: disabledSubject, productCode: disabledCode } }),
      dataSource.query(
        `SELECT count(*)::int AS count FROM outbox_events WHERE payload->>'logtoSub' = $1 AND payload->>'productCode' = $2`,
        [disabledSubject, disabledCode],
      ),
    ]);
    expect({ redemptions, subscriptions, grants, outbox: outbox[0].count }).toEqual({
      redemptions: 0,
      subscriptions: 0,
      grants: 0,
      outbox: 0,
    });

    const snapshot = await entitlements.resolve({
      subjectKind: "USER",
      subjectId: disabledSubject,
      productCode: disabledCode,
    });
    expect(snapshot.trial).toEqual({
      active: false,
      endsAt: null,
      consumed: false,
      eligible: false,
    });
  });

  it("preserves once-only seven-day behavior for standard products", async () => {
    const { trials, entitlements } = services();
    const before = await entitlements.resolve({
      subjectKind: "USER",
      subjectId: standardSubject,
      productCode: standardCode,
    });
    expect(before.trial.eligible).toBe(true);

    const first = await trials.ensureTrial({
      logtoSub: standardSubject,
      productCode: standardCode,
      actor: standardSubject,
    });
    const second = await trials.ensureTrial({
      logtoSub: standardSubject,
      productCode: standardCode,
      actor: standardSubject,
    });

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, subscriptionId: first.subscriptionId });
    expect(new Date(first.endsAt).getTime() - new Date(first.startsAt).getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    await expect(
      dataSource
        .getRepository(TrialRedemptionEntity)
        .count({ where: { logtoSub: standardSubject, productCode: standardCode } }),
    ).resolves.toBe(1);
    const snapshot = await entitlements.resolve({
      subjectKind: "USER",
      subjectId: standardSubject,
      productCode: standardCode,
    });
    expect(snapshot.trial).toMatchObject({ active: true, consumed: true, eligible: false });
  });
});
