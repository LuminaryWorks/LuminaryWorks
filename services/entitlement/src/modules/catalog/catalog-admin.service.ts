import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, type Repository } from "typeorm";
import {
  assertSellableOfferingPlan,
  assertUltraSupersetOfPro,
  isBillingInterval,
  isBillingMarket,
  isOfferingPlanCode,
  type PlanFeatureSnapshot,
} from "../../common/catalog-pricing";
import { EntitlementException } from "../../common/errors";
import { CatalogRevisionEntity } from "../../database/entities/catalog-revision.entity";
import { OfferingEntity } from "../../database/entities/offering.entity";
import { PlanEntity } from "../../database/entities/plan.entity";
import { PlanFeatureEntity } from "../../database/entities/plan-feature.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { AuditService } from "../audit/audit.service";
import { toPublicOffering } from "./catalog.service";

export type OfferingDraftInput = {
  sku: string;
  productCode: string;
  planCode: string;
  interval: string;
  currency: string;
  amountMinor: number;
  market: string;
  active?: boolean;
};

@Injectable()
export class CatalogAdminService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(CatalogRevisionEntity)
    private readonly revisions: Repository<CatalogRevisionEntity>,
    @InjectRepository(OfferingEntity)
    private readonly offerings: Repository<OfferingEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(PlanEntity)
    private readonly plans: Repository<PlanEntity>,
    @InjectRepository(PlanFeatureEntity)
    private readonly planFeatures: Repository<PlanFeatureEntity>,
    private readonly audit: AuditService,
  ) {}

  async listRevisions() {
    const rows = await this.revisions.find({ order: { version: "DESC" } });
    return {
      items: rows.map((row) => ({
        id: row.id,
        version: row.version,
        status: row.status,
        notes: row.notes,
        publishedAt: row.publishedAt,
        supersededAt: row.supersededAt,
        createdAt: row.createdAt,
      })),
    };
  }

  async getRevision(id: string) {
    const revision = await this.revisions.findOne({ where: { id } });
    if (!revision) {
      throw new EntitlementException("NOT_FOUND", `Unknown catalog revision ${id}`);
    }
    const offerings = await this.offerings.find({
      where: { revisionId: revision.id },
      order: { sku: "ASC" },
    });
    return {
      id: revision.id,
      version: revision.version,
      status: revision.status,
      notes: revision.notes,
      publishedAt: revision.publishedAt,
      supersededAt: revision.supersededAt,
      createdAt: revision.createdAt,
      offerings: offerings.map(toPublicOffering),
    };
  }

  async createDraft(input: {
    notes?: string;
    copyFromPublished?: boolean;
    offerings?: OfferingDraftInput[];
    actor: string;
    requestId?: string;
  }) {
    const existing = await this.revisions.find();
    const nextVersion =
      existing.reduce((max, row) => (row.version > max ? row.version : max), 0) + 1;
    const copyFromPublished = input.copyFromPublished !== false;
    const published = copyFromPublished
      ? await this.revisions.findOne({ where: { status: "published" } })
      : null;
    const source: OfferingDraftInput[] =
      input.offerings ??
      (published
        ? (await this.offerings.find({ where: { revisionId: published.id } })).map((row) => ({
            sku: row.sku,
            productCode: row.productCode,
            planCode: row.planCode,
            interval: row.interval,
            currency: row.currency,
            amountMinor: row.amountMinor,
            market: row.market,
            active: row.active,
          }))
        : []);

    const revision = await this.revisions.save(
      this.revisions.create({
        version: nextVersion,
        status: "draft",
        notes: input.notes ?? null,
        publishedAt: null,
        supersededAt: null,
      }),
    );
    const drafts = await this.validatedOfferingRows(source);
    for (const draft of drafts) {
      await this.offerings.save(
        this.offerings.create({
          sku: draft.sku,
          productCode: draft.productCode,
          planCode: draft.planCode,
          interval: draft.interval,
          currency: draft.currency,
          amountMinor: draft.amountMinor,
          market: draft.market,
          active: draft.active,
          revisionId: revision.id,
        }),
      );
    }
    await this.audit.record({
      actor: input.actor,
      action: "catalog.revision.create",
      resourceType: "catalog_revision",
      resourceId: revision.id,
      requestId: input.requestId,
      payload: { version: revision.version, copyFromPublished },
    });
    return this.getRevision(revision.id);
  }

  async replaceDraftOfferings(
    revisionId: string,
    offerings: OfferingDraftInput[],
    opts: { actor: string; requestId?: string },
  ) {
    const revision = await this.requireDraft(revisionId);
    const rows = await this.validatedOfferingRows(offerings);
    const existing = await this.offerings.find({ where: { revisionId: revision.id } });
    if (existing.length > 0) await this.offerings.remove(existing);
    for (const row of rows) {
      await this.offerings.save(this.offerings.create({ ...row, revisionId: revision.id }));
    }
    await this.audit.record({
      actor: opts.actor,
      action: "catalog.revision.offerings.replace",
      resourceType: "catalog_revision",
      resourceId: revision.id,
      requestId: opts.requestId,
      payload: { count: rows.length },
    });
    return this.getRevision(revision.id);
  }

  async publish(revisionId: string, opts: { actor: string; requestId?: string }) {
    const revision = await this.requireDraft(revisionId);
    const offerings = await this.offerings.find({ where: { revisionId: revision.id } });
    await this.validatedOfferingRows(
      offerings.map((row) => ({
        sku: row.sku,
        productCode: row.productCode,
        planCode: row.planCode,
        interval: row.interval,
        currency: row.currency,
        amountMinor: row.amountMinor,
        market: row.market,
        active: row.active,
      })),
    );
    await this.assertCurrentUltraSuperset();

    await this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(CatalogRevisionEntity, {
        where: { status: "published" },
      });
      if (current && current.id !== revision.id) {
        current.status = "superseded";
        current.supersededAt = new Date();
        await manager.save(current);
      }
      revision.status = "published";
      revision.publishedAt = new Date();
      revision.supersededAt = null;
      await manager.save(revision);
    });

    await this.audit.record({
      actor: opts.actor,
      action: "catalog.revision.publish",
      resourceType: "catalog_revision",
      resourceId: revision.id,
      requestId: opts.requestId,
      payload: { version: revision.version },
    });
    return this.getRevision(revision.id);
  }

  async rollback(revisionId: string, opts: { actor: string; requestId?: string }) {
    const revision = await this.revisions.findOne({ where: { id: revisionId } });
    if (!revision) {
      throw new EntitlementException("NOT_FOUND", `Unknown catalog revision ${revisionId}`);
    }
    if (revision.status === "draft") {
      throw new EntitlementException("VALIDATION_ERROR", "Cannot rollback to a draft revision");
    }
    if (revision.status === "published") {
      return this.getRevision(revision.id);
    }

    await this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(CatalogRevisionEntity, {
        where: { status: "published" },
      });
      if (current && current.id !== revision.id) {
        current.status = "superseded";
        current.supersededAt = new Date();
        await manager.save(current);
      }
      revision.status = "published";
      revision.publishedAt = revision.publishedAt ?? new Date();
      revision.supersededAt = null;
      await manager.save(revision);
    });

    await this.audit.record({
      actor: opts.actor,
      action: "catalog.revision.rollback",
      resourceType: "catalog_revision",
      resourceId: revision.id,
      requestId: opts.requestId,
      payload: { version: revision.version },
    });
    return this.getRevision(revision.id);
  }

  private async requireDraft(revisionId: string): Promise<CatalogRevisionEntity> {
    const revision = await this.revisions.findOne({ where: { id: revisionId } });
    if (!revision) {
      throw new EntitlementException("NOT_FOUND", `Unknown catalog revision ${revisionId}`);
    }
    if (revision.status !== "draft") {
      throw new EntitlementException("VALIDATION_ERROR", "Only draft revisions can be edited");
    }
    return revision;
  }

  async validatedOfferingRows(offerings: OfferingDraftInput[]): Promise<
    Array<{
      sku: string;
      productCode: string;
      planCode: OfferingEntity["planCode"];
      interval: OfferingEntity["interval"];
      currency: string;
      amountMinor: number;
      market: OfferingEntity["market"];
      active: boolean;
    }>
  > {
    const seen = new Set<string>();
    const productCodes = [...new Set(offerings.map((row) => row.productCode))];
    const products =
      productCodes.length === 0
        ? []
        : await this.products.find({ where: { code: In(productCodes), active: true } });
    const byCode = new Map(products.map((p) => [p.code, p]));
    const rows = [];
    for (const offering of offerings) {
      if (!offering.sku?.trim()) {
        throw new EntitlementException("PAYMENT_OFFERING_INVALID", "Offering sku is required");
      }
      if (seen.has(offering.sku)) {
        throw new EntitlementException(
          "VALIDATION_ERROR",
          `Duplicate offering sku ${offering.sku}`,
        );
      }
      seen.add(offering.sku);
      if (typeof offering.amountMinor !== "number" || offering.amountMinor <= 0) {
        throw new EntitlementException(
          "PAYMENT_OFFERING_INVALID",
          "Offering amountMinor must be a positive integer",
          { details: { sku: offering.sku, amountMinor: offering.amountMinor } },
        );
      }
      if (!Number.isInteger(offering.amountMinor)) {
        throw new EntitlementException(
          "PAYMENT_OFFERING_INVALID",
          "Offering amountMinor must be a positive integer",
          { details: { sku: offering.sku } },
        );
      }
      if (!offering.currency?.trim()) {
        throw new EntitlementException("PAYMENT_OFFERING_INVALID", "Offering currency is required");
      }
      if (!isBillingInterval(offering.interval)) {
        throw new EntitlementException(
          "PAYMENT_OFFERING_INVALID",
          "Offering interval must be month or year",
        );
      }
      if (!isBillingMarket(offering.market)) {
        throw new EntitlementException(
          "PAYMENT_OFFERING_INVALID",
          "Offering market must be CN or GLOBAL",
        );
      }
      assertSellableOfferingPlan(offering.planCode);
      if (!isOfferingPlanCode(offering.planCode)) {
        throw new EntitlementException(
          "PAYMENT_OFFERING_INVALID",
          "Offering plan must be pro or ultra",
        );
      }
      const product = byCode.get(offering.productCode);
      if (!product) {
        throw new EntitlementException("NOT_FOUND", `Unknown product ${offering.productCode}`, {
          productCode: offering.productCode,
        });
      }
      const active = offering.active !== false;
      if (active && !product.sellable) {
        throw new EntitlementException(
          "PRODUCT_NOT_SELLABLE",
          `Product ${offering.productCode} is not sellable`,
          { productCode: offering.productCode },
        );
      }
      rows.push({
        sku: offering.sku,
        productCode: offering.productCode,
        planCode: offering.planCode,
        interval: offering.interval,
        currency: offering.currency,
        amountMinor: offering.amountMinor,
        market: offering.market,
        active,
      });
    }
    return rows;
  }

  async assertCurrentUltraSuperset(): Promise<void> {
    const products = await this.products.find({ where: { active: true } });
    const snapshots = [];
    for (const product of products) {
      const plans = await this.plans.find({ where: { productId: product.id, active: true } });
      const pro = plans.find((p) => p.code === "pro");
      const ultra = plans.find((p) => p.code === "ultra");
      if (!pro || !ultra) continue;
      const pfs = await this.planFeatures.find({
        where: { planId: In([pro.id, ultra.id]) },
        relations: { feature: true },
      });
      const toSnapshot = (planId: string): PlanFeatureSnapshot[] =>
        pfs
          .filter((row) => row.planId === planId)
          .map((row) => ({
            featureCode: row.feature.code,
            kind: row.feature.kind,
            effect: row.effect,
            limitValue: row.limitValue == null ? null : Number(row.limitValue),
          }));
      snapshots.push({
        productCode: product.code,
        pro: toSnapshot(pro.id),
        ultra: toSnapshot(ultra.id),
      });
    }
    assertUltraSupersetOfPro(snapshots);
  }
}
