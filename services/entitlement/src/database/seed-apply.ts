import type { DataSource } from "typeorm";
import { BundleEntity } from "./entities/bundle.entity";
import { BundleItemEntity } from "./entities/bundle-item.entity";
import { FeatureEntity } from "./entities/feature.entity";
import { PlanEntity } from "./entities/plan.entity";
import { PlanFeatureEntity } from "./entities/plan-feature.entity";
import { ProductEntity } from "./entities/product.entity";
import { CATALOG, SAMPLE_BUNDLE, type ProductSeed } from "./seed-catalog";

export async function applyCatalog(
  dataSource: Pick<DataSource, "getRepository">,
  catalog: ProductSeed[] = CATALOG,
): Promise<void> {
  const products = dataSource.getRepository(ProductEntity);
  const features = dataSource.getRepository(FeatureEntity);
  const plans = dataSource.getRepository(PlanEntity);
  const planFeatures = dataSource.getRepository(PlanFeatureEntity);
  const bundles = dataSource.getRepository(BundleEntity);
  const bundleItems = dataSource.getRepository(BundleItemEntity);

  for (const productSeed of catalog) {
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
    } else {
      product.name = productSeed.name;
      product.active = true;
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
      } else {
        row.name = f.name;
        row.kind = f.kind;
        row.quotaPeriod = f.quotaPeriod ?? row.quotaPeriod;
        row.quotaMerge = f.quotaMerge ?? row.quotaMerge;
        row = await features.save(row);
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
      } else {
        plan.name = planSeed.name;
        plan.rank = planSeed.rank;
        plan.active = true;
        plan = await plans.save(plan);
      }
      for (const pf of planSeed.features) {
        const feature = featureByCode.get(pf.code);
        if (!feature) continue;
        const existing = await planFeatures.findOne({
          where: { planId: plan.id, featureId: feature.id },
        });
        const effect = pf.effect ?? "allow";
        const limitValue = pf.limitValue == null ? null : String(pf.limitValue);
        if (existing) {
          existing.effect = effect;
          existing.limitValue = limitValue;
          await planFeatures.save(existing);
          continue;
        }
        await planFeatures.save(
          planFeatures.create({
            planId: plan.id,
            featureId: feature.id,
            effect,
            limitValue,
            quotaMerge: null,
          }),
        );
      }

      const wantedFeatureIds = new Set(
        planSeed.features
          .map((pf) => featureByCode.get(pf.code)?.id)
          .filter((id): id is string => Boolean(id)),
      );
      const attached = await planFeatures.find({ where: { planId: plan.id } });
      for (const row of attached) {
        if (!wantedFeatureIds.has(row.featureId)) await planFeatures.remove(row);
      }
    }
  }

  let bundle = await bundles.findOne({ where: { sku: SAMPLE_BUNDLE.sku } });
  if (!bundle) {
    bundle = await bundles.save(
      bundles.create({
        sku: SAMPLE_BUNDLE.sku,
        name: SAMPLE_BUNDLE.name,
        active: true,
      }),
    );
    for (const productCode of SAMPLE_BUNDLE.productCodes) {
      await bundleItems.save(
        bundleItems.create({
          bundleId: bundle.id,
          productCode,
          planCode: SAMPLE_BUNDLE.planCode,
        }),
      );
    }
  }
}
