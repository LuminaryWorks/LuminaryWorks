import type { DataSource, Repository } from "typeorm";
import { BundleEntity } from "./entities/bundle.entity";
import { BundleItemEntity } from "./entities/bundle-item.entity";
import { CatalogRevisionEntity } from "./entities/catalog-revision.entity";
import { FeatureEntity } from "./entities/feature.entity";
import { OfferingEntity } from "./entities/offering.entity";
import { PlanEntity } from "./entities/plan.entity";
import { PlanFeatureEntity } from "./entities/plan-feature.entity";
import { ProductEntity } from "./entities/product.entity";
import {
  CATALOG,
  SAMPLE_BUNDLE,
  SEED_OFFERINGS,
  type OfferingSeed,
  type ProductSeed,
} from "./seed-catalog";

export async function applyCatalog(
  dataSource: Pick<DataSource, "getRepository">,
  catalog: ProductSeed[] = CATALOG,
  offerings: OfferingSeed[] = SEED_OFFERINGS,
): Promise<void> {
  const products = dataSource.getRepository(ProductEntity);
  const features = dataSource.getRepository(FeatureEntity);
  const plans = dataSource.getRepository(PlanEntity);
  const planFeatures = dataSource.getRepository(PlanFeatureEntity);
  const bundles = dataSource.getRepository(BundleEntity);
  const bundleItems = dataSource.getRepository(BundleItemEntity);
  const revisions = dataSource.getRepository(CatalogRevisionEntity);
  const offeringRows = dataSource.getRepository(OfferingEntity);

  for (const productSeed of catalog) {
    let product = await products.findOne({ where: { code: productSeed.code } });
    if (!product) {
      product = await products.save(
        products.create({
          code: productSeed.code,
          name: productSeed.name,
          active: true,
          trialPolicy: productSeed.trialPolicy,
          sellable: productSeed.sellable,
        }),
      );
    } else {
      product.name = productSeed.name;
      product.active = true;
      product.trialPolicy = productSeed.trialPolicy;
      product.sellable = productSeed.sellable;
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
            meteringMode: f.meteringMode ?? "counter",
            description: null,
          }),
        );
      } else {
        row.name = f.name;
        row.kind = f.kind;
        row.quotaPeriod = f.quotaPeriod ?? row.quotaPeriod;
        row.quotaMerge = f.quotaMerge ?? row.quotaMerge;
        row.meteringMode = f.meteringMode ?? row.meteringMode ?? "counter";
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

  await applySeedOfferings(revisions, offeringRows, offerings);
}

async function applySeedOfferings(
  revisions: Pick<Repository<CatalogRevisionEntity>, "find" | "findOne" | "save" | "create">,
  offeringRows: Pick<Repository<OfferingEntity>, "find" | "findOne" | "save" | "create">,
  offerings: OfferingSeed[],
): Promise<void> {
  let published = await revisions.findOne({ where: { status: "published" } });
  if (!published) {
    const existing = await revisions.find();
    const nextVersion =
      existing.reduce((max, row) => (row.version > max ? row.version : max), 0) + 1;
    published = await revisions.save(
      revisions.create({
        version: nextVersion,
        status: "published",
        notes: "seed",
        publishedAt: new Date(),
        supersededAt: null,
      }),
    );
  }

  const wantedSkus = new Set(offerings.map((row) => row.sku));
  for (const seed of offerings) {
    const row = await offeringRows.findOne({
      where: { revisionId: published.id, sku: seed.sku },
    });
    if (!row) {
      await offeringRows.save(
        offeringRows.create({
          sku: seed.sku,
          productCode: seed.productCode,
          planCode: seed.planCode,
          interval: seed.interval,
          currency: seed.currency,
          amountMinor: seed.amountMinor,
          market: seed.market,
          active: seed.active,
          revisionId: published.id,
        }),
      );
      continue;
    }
    row.productCode = seed.productCode;
    row.planCode = seed.planCode;
    row.interval = seed.interval;
    row.currency = seed.currency;
    row.amountMinor = seed.amountMinor;
    row.market = seed.market;
    row.active = seed.active;
    await offeringRows.save(row);
  }

  const attached = await offeringRows.find({ where: { revisionId: published.id } });
  for (const row of attached) {
    if (wantedSkus.has(row.sku)) continue;
    row.active = false;
    await offeringRows.save(row);
  }
}
