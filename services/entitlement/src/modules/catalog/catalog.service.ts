import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, type Repository } from "typeorm";
import { EntitlementException } from "../../common/errors";
import { FeatureEntity } from "../../database/entities/feature.entity";
import { PlanEntity } from "../../database/entities/plan.entity";
import { PlanFeatureEntity } from "../../database/entities/plan-feature.entity";
import { ProductEntity } from "../../database/entities/product.entity";

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
        features: features.map((f) => ({
          code: f.code,
          name: f.name,
          kind: f.kind,
          quotaPeriod: f.quotaPeriod,
          quotaMerge: f.quotaMerge,
          description: f.description,
        })),
      });
    }
    return out;
  }
}
