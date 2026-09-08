import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, type Repository } from "typeorm";
import type { BillingMarket } from "../../common/catalog-pricing";
import { EntitlementException } from "../../common/errors";
import { CatalogRevisionEntity } from "../../database/entities/catalog-revision.entity";
import { FeatureEntity } from "../../database/entities/feature.entity";
import { OfferingEntity } from "../../database/entities/offering.entity";
import { PlanEntity } from "../../database/entities/plan.entity";
import { PlanFeatureEntity } from "../../database/entities/plan-feature.entity";
import { ProductEntity } from "../../database/entities/product.entity";

export function toPublicOffering(offering: OfferingEntity) {
  return {
    id: offering.id,
    sku: offering.sku,
    productCode: offering.productCode,
    planCode: offering.planCode,
    interval: offering.interval,
    currency: offering.currency,
    amountMinor: offering.amountMinor,
    market: offering.market,
    active: offering.active,
    catalogRevisionId: offering.revisionId,
  };
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(PlanEntity)
    private readonly plans: Repository<PlanEntity>,
    @InjectRepository(FeatureEntity)
    private readonly features: Repository<FeatureEntity>,
    @InjectRepository(PlanFeatureEntity)
    private readonly planFeatures: Repository<PlanFeatureEntity>,
    @InjectRepository(CatalogRevisionEntity)
    private readonly revisions: Repository<CatalogRevisionEntity>,
    @InjectRepository(OfferingEntity)
    private readonly offerings: Repository<OfferingEntity>,
  ) {}

  async listPlans(productCode?: string) {
    const products = productCode
      ? await this.products.find({ where: { code: productCode, active: true } })
      : await this.products.find({ where: { active: true } });
    if (productCode && products.length === 0) {
      throw new EntitlementException("NOT_FOUND", `Unknown product ${productCode}`, {
        productCode,
      });
    }
    const result = [];
    for (const product of products) {
      const plans = await this.plans.find({
        where: { productId: product.id, active: true },
        order: { rank: "ASC" },
      });
      const pfs =
        plans.length === 0
          ? []
          : await this.planFeatures.find({
              where: { planId: In(plans.map((p) => p.id)) },
              relations: { feature: true },
            });
      const byPlan = new Map<string, typeof pfs>();
      for (const pf of pfs) {
        const list = byPlan.get(pf.planId) ?? [];
        list.push(pf);
        byPlan.set(pf.planId, list);
      }
      result.push({
        productCode: product.code,
        productName: product.name,
        trialPolicy: product.trialPolicy,
        sellable: product.sellable,
        plans: plans.map((p) => ({
          code: p.code,
          name: p.name,
          rank: p.rank,
          features: (byPlan.get(p.id) ?? []).map((pf) => ({
            featureCode: pf.feature.code,
            effect: pf.effect,
            limitValue: pf.limitValue == null ? null : Number(pf.limitValue),
            kind: pf.feature.kind,
            quotaPeriod: pf.feature.quotaPeriod,
            quotaMerge: pf.quotaMerge ?? pf.feature.quotaMerge,
            meteringMode: pf.feature.meteringMode ?? "counter",
          })),
        })),
      });
    }
    return result;
  }

  async listFeatures(productCode?: string) {
    const products = productCode
      ? await this.products.find({ where: { code: productCode, active: true } })
      : await this.products.find({ where: { active: true } });
    const out = [];
    for (const product of products) {
      const features = await this.features.find({
        where: { productId: product.id },
        order: { code: "ASC" },
      });
      out.push({
        productCode: product.code,
        sellable: product.sellable,
        features: features.map((f) => ({
          code: f.code,
          name: f.name,
          kind: f.kind,
          quotaPeriod: f.quotaPeriod,
          quotaMerge: f.quotaMerge,
          meteringMode: f.meteringMode ?? "counter",
          description: f.description,
        })),
      });
    }
    return out;
  }

  async getPublishedRevision(): Promise<CatalogRevisionEntity | null> {
    return this.revisions.findOne({ where: { status: "published" } });
  }

  async listPublishedOfferings(opts?: { productCode?: string; market?: BillingMarket }) {
    const published = await this.getPublishedRevision();
    if (!published) {
      return { catalogRevisionId: null, items: [] as ReturnType<typeof toPublicOffering>[] };
    }
    const where: {
      revisionId: string;
      active: boolean;
      productCode?: string;
      market?: BillingMarket;
    } = { revisionId: published.id, active: true };
    if (opts?.productCode) where.productCode = opts.productCode;
    if (opts?.market) where.market = opts.market;
    const rows = await this.offerings.find({
      where,
      order: { productCode: "ASC", sku: "ASC" },
    });
    const sellableCodes = new Set(
      (await this.products.find({ where: { active: true, sellable: true } })).map((p) => p.code),
    );
    return {
      catalogRevisionId: published.id,
      items: rows.filter((row) => sellableCodes.has(row.productCode)).map(toPublicOffering),
    };
  }

  async findPublishedOffering(input: {
    offeringId?: string;
    sku?: string;
  }): Promise<OfferingEntity> {
    const published = await this.getPublishedRevision();
    if (!published) {
      throw new EntitlementException("PAYMENT_OFFERING_INVALID", "No published catalog revision");
    }
    let offering: OfferingEntity | null = null;
    if (input.offeringId) {
      offering = await this.offerings.findOne({
        where: { id: input.offeringId, revisionId: published.id },
      });
    } else if (input.sku) {
      offering = await this.offerings.findOne({
        where: { sku: input.sku, revisionId: published.id },
      });
    }
    if (!offering || !offering.active) {
      throw new EntitlementException(
        "PAYMENT_OFFERING_INVALID",
        "Offering is not in the published catalog",
      );
    }
    return offering;
  }
}
