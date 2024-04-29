import "reflect-metadata";
import type { PlanCode, QuotaPeriod, TrialPolicy } from "../common/constants";
import dataSource from "./data-source";
import { BundleEntity } from "./entities/bundle.entity";
import { BundleItemEntity } from "./entities/bundle-item.entity";
import { FeatureEntity } from "./entities/feature.entity";
import { PlanEntity } from "./entities/plan.entity";
import { PlanFeatureEntity } from "./entities/plan-feature.entity";
import { ProductEntity } from "./entities/product.entity";

type FeatureSeed = {
  code: string;
  name: string;
  kind: "bool" | "quota";
  quotaPeriod?: QuotaPeriod;
  quotaMerge?: "max" | "sum";
};

type PlanSeed = {
  code: PlanCode;
  name: string;
  rank: number;
  features: Array<{
    code: string;
    effect?: "allow" | "deny";
    limitValue?: number;
  }>;
};

const CATALOG: Array<{
  code: string;
  name: string;
  trialPolicy: TrialPolicy;
  features: FeatureSeed[];
  plans: PlanSeed[];
}> = [
  {
    code: "vistaremote",
    name: "VistaRemote",
    trialPolicy: "standard_7d",
    features: [
      { code: "webrtc.sfu", name: "WebRTC SFU", kind: "bool" },
      { code: "recording", name: "Recording", kind: "bool" },
      {
        code: "ai.recording_summarize",
        name: "AI recording summarize",
        kind: "bool",
      },
      { code: "ai.cloud_infer", name: "AI cloud infer", kind: "bool" },
      {
        code: "recording.sfu_server",
        name: "SFU server recording",
        kind: "bool",
      },
      {
        code: "telemetry.enterprise",
        name: "Enterprise telemetry",
        kind: "bool",
      },
      {
        code: "batch.remote",
        name: "Batch remote control",
        kind: "bool",
      },
      {
        code: "device.limit",
        name: "Device limit",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
    ],
    plans: [
      {
        code: "trial",
        name: "Trial",
        rank: 1,
        features: [
          { code: "webrtc.sfu" },
          { code: "recording" },
          { code: "ai.recording_summarize" },
          { code: "batch.remote" },
          { code: "device.limit", limitValue: 3 },
        ],
      },
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "webrtc.sfu" },
          { code: "recording" },
          { code: "ai.recording_summarize" },
          { code: "batch.remote" },
          { code: "device.limit", limitValue: 10 },
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "webrtc.sfu" },
          { code: "recording" },
          { code: "ai.recording_summarize" },
          { code: "ai.cloud_infer" },
          { code: "recording.sfu_server" },
          { code: "batch.remote" },
          { code: "device.limit", limitValue: 50 },
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "webrtc.sfu" },
          { code: "recording" },
          { code: "ai.recording_summarize" },
          { code: "ai.cloud_infer" },
          { code: "recording.sfu_server" },
          { code: "telemetry.enterprise" },
          { code: "batch.remote" },
          { code: "device.limit", limitValue: 500 },
        ],
      },
    ],
  },
  {
    code: "blockyedu",
    name: "BlockyEdu",
    trialPolicy: "standard_7d",
    features: [
      { code: "code.execute.pro", name: "Pro code execute", kind: "bool" },
      { code: "ai.copilot", name: "AI copilot", kind: "bool" },
      { code: "ai.tutor", name: "AI tutor", kind: "bool" },
      {
        code: "student.limit",
        name: "Student seats",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
    ],
    plans: [
      {
        code: "trial",
        name: "Trial",
        rank: 1,
        features: [
          { code: "code.execute.pro" },
          { code: "ai.copilot" },
          { code: "student.limit", limitValue: 30 },
        ],
      },
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "code.execute.pro" },
          { code: "ai.copilot" },
          { code: "student.limit", limitValue: 100 },
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "code.execute.pro" },
          { code: "ai.copilot" },
          { code: "ai.tutor" },
          { code: "student.limit", limitValue: 500 },
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "code.execute.pro" },
          { code: "ai.copilot" },
          { code: "ai.tutor" },
          { code: "student.limit", limitValue: 5000 },
        ],
      },
    ],
  },
  {
    code: "dataluminary",
    name: "DataLuminary",
    trialPolicy: "standard_7d",
    features: [
      { code: "dashboard.export", name: "Dashboard export", kind: "bool" },
      { code: "ai.analysis", name: "AI analysis", kind: "bool" },
      {
        code: "storage.bytes",
        name: "Storage bytes",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
      {
        code: "dashboard.count",
        name: "Dashboard count",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
    ],
    plans: [
      {
        code: "trial",
        name: "Trial",
        rank: 1,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "dashboard.count", limitValue: 5 },
          { code: "storage.bytes", limitValue: 1_073_741_824 },
        ],
      },
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "dashboard.count", limitValue: 50 },
          { code: "storage.bytes", limitValue: 10_737_418_240 },
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "dashboard.count", limitValue: 200 },
          { code: "storage.bytes", limitValue: 107_374_182_400 },
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "dashboard.count", limitValue: 2000 },
          { code: "storage.bytes", limitValue: 1_099_511_627_776 },
        ],
      },
    ],
  },
  {
    code: "doerflow",
    name: "DoerFlow",
    trialPolicy: "disabled",
    features: [
      { code: "agent.publish", name: "Publish agents", kind: "bool" },
      { code: "skill.register", name: "Register skills", kind: "bool" },
      { code: "task.publish", name: "Publish tasks", kind: "bool" },
      { code: "ai.strategy.run", name: "Run AI strategies", kind: "bool" },
      {
        code: "settlement.merkle_batch",
        name: "Merkle batch settlement",
        kind: "bool",
      },
      { code: "admin.ops.read", name: "Read platform operations", kind: "bool" },
      {
        code: "agent.limit",
        name: "Published agent limit",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
      {
        code: "task.publish.monthly",
        name: "Monthly task publications",
        kind: "quota",
        quotaPeriod: "calendar_month",
      },
      {
        code: "api.request.monthly",
        name: "Monthly API requests",
        kind: "quota",
        quotaPeriod: "calendar_month",
      },
    ],
    plans: [
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "agent.publish" },
          { code: "skill.register" },
          { code: "task.publish" },
          { code: "agent.limit", limitValue: 10 },
          { code: "task.publish.monthly", limitValue: 100 },
          { code: "api.request.monthly", limitValue: 10_000 },
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "agent.publish" },
          { code: "skill.register" },
          { code: "task.publish" },
          { code: "ai.strategy.run" },
          { code: "settlement.merkle_batch" },
          { code: "agent.limit", limitValue: 100 },
          { code: "task.publish.monthly", limitValue: 1_000 },
          { code: "api.request.monthly", limitValue: 100_000 },
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "agent.publish" },
          { code: "skill.register" },
          { code: "task.publish" },
          { code: "ai.strategy.run" },
          { code: "settlement.merkle_batch" },
          { code: "admin.ops.read" },
          { code: "agent.limit", limitValue: 10_000 },
          { code: "task.publish.monthly", limitValue: 100_000 },
          { code: "api.request.monthly", limitValue: 10_000_000 },
        ],
      },
    ],
  },
];

async function seed() {
  await dataSource.initialize();
  const products = dataSource.getRepository(ProductEntity);
  const features = dataSource.getRepository(FeatureEntity);
  const plans = dataSource.getRepository(PlanEntity);
  const planFeatures = dataSource.getRepository(PlanFeatureEntity);
  const bundles = dataSource.getRepository(BundleEntity);
  const bundleItems = dataSource.getRepository(BundleItemEntity);

  for (const productSeed of CATALOG) {
    let product = await products.findOne({ where: { code: productSeed.code } });
    if (!product) {
      product = await products.save(
        products.create({
          code: productSeed.code,
          name: productSeed.name,
          active: true,
          trialPolicy: productSeed.trialPolicy,
        }),
      );
    } else if (product.trialPolicy !== productSeed.trialPolicy) {
      product.trialPolicy = productSeed.trialPolicy;
      product = await products.save(product);
    }

    const featureByCode = new Map<string, FeatureEntity>();
    for (const f of productSeed.features) {
      let row = await features.findOne({
        where: { productId: product.id, code: f.code },
      });
      if (!row) {
        row = await features.save(
          features.create({
            productId: product.id,
            code: f.code,
            name: f.name,
            kind: f.kind,
            quotaPeriod: f.quotaPeriod ?? null,
            quotaMerge: f.quotaMerge ?? "max",
            description: null,
          }),
        );
      }
      featureByCode.set(f.code, row);
    }

    if (productSeed.trialPolicy === "disabled") {
      const trialPlan = await plans.findOne({
        where: { productId: product.id, code: "trial" },
      });
      if (trialPlan) await plans.remove(trialPlan);
    }

    for (const planSeed of productSeed.plans) {
      let plan = await plans.findOne({
        where: { productId: product.id, code: planSeed.code },
      });
      if (!plan) {
        plan = await plans.save(
          plans.create({
            productId: product.id,
            code: planSeed.code,
            name: planSeed.name,
            rank: planSeed.rank,
            active: true,
          }),
        );
      }
      for (const pf of planSeed.features) {
        const feature = featureByCode.get(pf.code);
        if (!feature) continue;
        const existing = await planFeatures.findOne({
          where: { planId: plan.id, featureId: feature.id },
        });
        if (existing) continue;
        await planFeatures.save(
          planFeatures.create({
            planId: plan.id,
            featureId: feature.id,
            effect: pf.effect ?? "allow",
            limitValue: pf.limitValue == null ? null : String(pf.limitValue),
            quotaMerge: null,
          }),
        );
      }
    }
  }

  let bundle = await bundles.findOne({ where: { sku: "luminary_pro_bundle" } });
  if (!bundle) {
    bundle = await bundles.save(
      bundles.create({
        sku: "luminary_pro_bundle",
        name: "Luminary Pro Bundle",
        active: true,
      }),
    );
    for (const productCode of ["dataluminary", "blockyedu", "vistaremote"]) {
      await bundleItems.save(
        bundleItems.create({
          bundleId: bundle.id,
          productCode,
          planCode: "pro",
        }),
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log("Seed complete: products, plans, features, sample bundle");
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
