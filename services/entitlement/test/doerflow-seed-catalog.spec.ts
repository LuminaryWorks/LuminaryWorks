import { randomUUID } from "node:crypto";
import { PRODUCT_CODES } from "../src/common/constants";
import {
  CATALOG,
  DOERFLOW_INTEGRATION_FEATURE_CODES,
  DOERFLOW_INTEGRATION_QUOTAS,
  DOERFLOW_INTEGRATION_WRITE_CODES,
  SAMPLE_BUNDLE,
  doerflowIntegrationPlanFeatures,
} from "../src/database/seed-catalog";
import { applyCatalog } from "../src/database/seed-apply";
import { BundleEntity } from "../src/database/entities/bundle.entity";
import { BundleItemEntity } from "../src/database/entities/bundle-item.entity";
import { FeatureEntity } from "../src/database/entities/feature.entity";
import { PlanEntity } from "../src/database/entities/plan.entity";
import { PlanFeatureEntity } from "../src/database/entities/plan-feature.entity";
import { ProductEntity } from "../src/database/entities/product.entity";

const PROTOCOL_ECONOMICS_CODES = [
  "protocol.fee",
  "job.unit_price",
  "escrow",
  "escrow.lock",
  "gas",
  "gas.sponsor",
];

type Row = Record<string, unknown> & { id: string };

class MemoryRepository {
  readonly items: Row[] = [];

  create(value: Record<string, unknown>): Row {
    return { id: randomUUID(), ...value };
  }

  async find({ where }: { where?: Record<string, unknown> } = {}): Promise<Row[]> {
    if (!where) return [...this.items];
    return this.items.filter((row) =>
      Object.entries(where).every(([key, expected]) => row[key] === expected),
    );
  }

  async findOne({ where }: { where: Record<string, unknown> }): Promise<Row | null> {
    return (await this.find({ where }))[0] ?? null;
  }

  async save(row: Row): Promise<Row> {
    const index = this.items.findIndex((item) => item.id === row.id);
    if (index >= 0) this.items[index] = row;
    else this.items.push(row);
    return row;
  }

  async remove(row: Row): Promise<Row> {
    const index = this.items.findIndex((item) => item.id === row.id);
    if (index >= 0) this.items.splice(index, 1);
    return row;
  }
}

function memoryDataSource() {
  const repos = new Map<unknown, MemoryRepository>([
    [ProductEntity, new MemoryRepository()],
    [FeatureEntity, new MemoryRepository()],
    [PlanEntity, new MemoryRepository()],
    [PlanFeatureEntity, new MemoryRepository()],
    [BundleEntity, new MemoryRepository()],
    [BundleItemEntity, new MemoryRepository()],
  ]);
  return {
    repos,
    getRepository: (entity: unknown) => {
      const repo = repos.get(entity);
      if (!repo) throw new Error(`unknown repository ${String(entity)}`);
      return repo;
    },
  };
}

describe("DoerFlow integration entitlement catalog", () => {
  const doerflow = CATALOG.find((product) => product.code === "doerflow");

  it("keeps trialPolicy disabled and only Pro/Ultra/Enterprise", () => {
    expect(doerflow).toBeDefined();
    expect(doerflow?.trialPolicy).toBe("disabled");
    expect(doerflow?.plans.map((plan) => plan.code)).toEqual(["pro", "ultra", "enterprise"]);
  });

  it("adds provider register, event submit, and monthly event/API quotas", () => {
    const codes = new Set(doerflow?.features.map((feature) => feature.code));
    expect(codes.has(DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister)).toBe(true);
    expect(codes.has(DOERFLOW_INTEGRATION_FEATURE_CODES.eventSubmit)).toBe(true);
    expect(codes.has(DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly)).toBe(true);
    expect(codes.has(DOERFLOW_INTEGRATION_FEATURE_CODES.apiMonthly)).toBe(true);

    const eventMonthly = doerflow?.features.find(
      (feature) => feature.code === DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly,
    );
    const apiMonthly = doerflow?.features.find(
      (feature) => feature.code === DOERFLOW_INTEGRATION_FEATURE_CODES.apiMonthly,
    );
    expect(eventMonthly).toMatchObject({ kind: "quota", quotaPeriod: "calendar_month" });
    expect(apiMonthly).toMatchObject({ kind: "quota", quotaPeriod: "calendar_month" });
  });

  it("keeps Pro closed for provider/event writes and omits integration quotas", () => {
    const pro = doerflow?.plans.find((plan) => plan.code === "pro");
    const codes = new Set(pro?.features.map((feature) => feature.code));
    for (const write of DOERFLOW_INTEGRATION_WRITE_CODES) {
      expect(codes.has(write)).toBe(false);
    }
    expect(codes.has(DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly)).toBe(false);
    expect(codes.has(DOERFLOW_INTEGRATION_FEATURE_CODES.apiMonthly)).toBe(false);
    expect(doerflowIntegrationPlanFeatures("pro")).toEqual([]);
  });

  it("maps Ultra modest and Enterprise high integration quotas onto existing paid plans", () => {
    for (const [code, quotas] of Object.entries(DOERFLOW_INTEGRATION_QUOTAS)) {
      const plan = doerflow?.plans.find((item) => item.code === code);
      const byCode = new Map(plan?.features.map((feature) => [feature.code, feature]));
      expect(byCode.get(DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister)).toBeDefined();
      expect(byCode.get(DOERFLOW_INTEGRATION_FEATURE_CODES.eventSubmit)).toBeDefined();
      expect(byCode.get(DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly)?.limitValue).toBe(
        quotas.eventMonthly,
      );
      expect(byCode.get(DOERFLOW_INTEGRATION_FEATURE_CODES.apiMonthly)?.limitValue).toBe(
        quotas.apiMonthly,
      );
    }
    expect(DOERFLOW_INTEGRATION_QUOTAS.enterprise.eventMonthly).toBeGreaterThan(
      DOERFLOW_INTEGRATION_QUOTAS.ultra.eventMonthly,
    );
    expect(DOERFLOW_INTEGRATION_QUOTAS.enterprise.apiMonthly).toBeGreaterThan(
      DOERFLOW_INTEGRATION_QUOTAS.ultra.apiMonthly,
    );
  });

  it("does not sell protocol fees, job unit prices, escrow, or gas as plan features", () => {
    const codes = CATALOG.flatMap((product) => product.features.map((feature) => feature.code));
    for (const forbidden of PROTOCOL_ECONOMICS_CODES) {
      expect(codes).not.toContain(forbidden);
    }
  });

  it("does not introduce VistaCast or SyncroBrain user-facing product SKUs", () => {
    expect(CATALOG.map((product) => product.code)).toEqual([
      "vistaremote",
      "blockyedu",
      "dataluminary",
      "doerflow",
    ]);
    expect([...PRODUCT_CODES]).not.toContain("vistacast");
    expect([...PRODUCT_CODES]).not.toContain("syncrobrain");
    expect(SAMPLE_BUNDLE.productCodes).toEqual(["dataluminary", "blockyedu", "vistaremote"]);
    expect(SAMPLE_BUNDLE.productCodes).not.toContain("vistacast");
    expect(SAMPLE_BUNDLE.productCodes).not.toContain("syncrobrain");
  });

  it("keeps feature and plan codes unique per product", () => {
    for (const product of CATALOG) {
      const featureCodes = product.features.map((feature) => feature.code);
      expect(new Set(featureCodes).size).toBe(featureCodes.length);
      const planCodes = product.plans.map((plan) => plan.code);
      expect(new Set(planCodes).size).toBe(planCodes.length);
      const knownFeatures = new Set(featureCodes);
      for (const plan of product.plans) {
        for (const feature of plan.features) {
          expect(knownFeatures.has(feature.code)).toBe(true);
        }
      }
    }
  });
});

describe("applyCatalog idempotency", () => {
  it("re-running seed does not duplicate products, features, plans, or plan features", async () => {
    const ds = memoryDataSource();
    await applyCatalog(ds as never);
    const snapshot = () => ({
      products: ds.repos.get(ProductEntity)?.items.length,
      features: ds.repos.get(FeatureEntity)?.items.length,
      plans: ds.repos.get(PlanEntity)?.items.length,
      planFeatures: ds.repos.get(PlanFeatureEntity)?.items.length,
      bundles: ds.repos.get(BundleEntity)?.items.length,
      bundleItems: ds.repos.get(BundleItemEntity)?.items.length,
    });
    const first = snapshot();
    await applyCatalog(ds as never);
    expect(snapshot()).toEqual(first);

    const products = ds.repos.get(ProductEntity)?.items ?? [];
    const doerflow = products.find((product) => product.code === "doerflow");
    expect(doerflow?.trialPolicy).toBe("disabled");

    const features = ds.repos.get(FeatureEntity)?.items ?? [];
    const plans = ds.repos.get(PlanEntity)?.items ?? [];
    const planFeatures = ds.repos.get(PlanFeatureEntity)?.items ?? [];
    const doerflowFeatures = features.filter((feature) => feature.productId === doerflow?.id);
    expect(
      doerflowFeatures.some(
        (feature) => feature.code === DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister,
      ),
    ).toBe(true);

    const pro = plans.find((plan) => plan.productId === doerflow?.id && plan.code === "pro");
    const ultra = plans.find((plan) => plan.productId === doerflow?.id && plan.code === "ultra");
    const eventFeature = doerflowFeatures.find(
      (feature) => feature.code === DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly,
    );
    const registerFeature = doerflowFeatures.find(
      (feature) => feature.code === DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister,
    );
    expect(
      planFeatures.find((row) => row.planId === pro?.id && row.featureId === eventFeature?.id),
    ).toBeUndefined();
    expect(
      planFeatures.find((row) => row.planId === pro?.id && row.featureId === registerFeature?.id),
    ).toBeUndefined();
    const ultraMapping = planFeatures.find(
      (row) => row.planId === ultra?.id && row.featureId === eventFeature?.id,
    );
    expect(ultraMapping?.limitValue).toBe(String(DOERFLOW_INTEGRATION_QUOTAS.ultra.eventMonthly));
  });

  it("re-seed prunes stale Pro provider/event write mappings", async () => {
    const ds = memoryDataSource();
    await applyCatalog(ds as never);
    const products = ds.repos.get(ProductEntity)?.items ?? [];
    const doerflow = products.find((product) => product.code === "doerflow");
    const plans = ds.repos.get(PlanEntity)?.items ?? [];
    const features = ds.repos.get(FeatureEntity)?.items ?? [];
    const planFeatures = ds.repos.get(PlanFeatureEntity);
    const pro = plans.find((plan) => plan.productId === doerflow?.id && plan.code === "pro");
    const registerFeature = features.find(
      (feature) =>
        feature.productId === doerflow?.id &&
        feature.code === DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister,
    );
    await planFeatures?.save({
      id: randomUUID(),
      planId: pro?.id,
      featureId: registerFeature?.id,
      effect: "allow",
      limitValue: null,
    });
    await applyCatalog(ds as never);
    expect(
      planFeatures?.items.find(
        (row) => row.planId === pro?.id && row.featureId === registerFeature?.id,
      ),
    ).toBeUndefined();
  });
});
