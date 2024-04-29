import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, type Repository } from "typeorm";
import type { PlanCode } from "../../common/constants";
import { EntitlementException } from "../../common/errors";
import { assertTrialPlanAllowed } from "../../common/trial-policy";
import { GrantEntity } from "../../database/entities/grant.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { PartnerEntity } from "../../database/entities/partner.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { PartnerBenefitEntity } from "../../database/entities/partner-benefit.entity";
import { RedemptionEntity } from "../../database/entities/redemption.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { AuditService } from "../audit/audit.service";
import type { CreateRedemptionDto } from "./partner.dto";
import { PartnerWebhookService } from "./partner-webhook.service";

@Injectable()
export class PartnerRedemptionService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(PartnerEntity)
    private readonly partners: Repository<PartnerEntity>,
    @InjectRepository(PartnerBenefitEntity)
    private readonly benefits: Repository<PartnerBenefitEntity>,
    @InjectRepository(RedemptionEntity)
    private readonly redemptions: Repository<RedemptionEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    private readonly audit: AuditService,
    private readonly webhooks: PartnerWebhookService,
  ) {}

  async redeem(input: {
    partnerId: string;
    body: CreateRedemptionDto;
    actor: string;
    requestId?: string;
  }) {
    const partner = await this.partners.findOne({
      where: { id: input.partnerId, active: true },
    });
    if (!partner) throw new EntitlementException("NOT_FOUND", "Partner not found");

    const existing = await this.redemptions.findOne({
      where: { redemptionId: input.body.redemptionId },
    });
    if (existing) {
      if (existing.partnerId !== partner.id) {
        throw new EntitlementException("CONFLICT", "redemptionId owned by another partner");
      }
      if (existing.productCode) {
        await assertTrialPlanAllowed(
          this.products,
          existing.productCode,
          (existing.payload as { planCode?: PlanCode }).planCode,
        );
      }
      return { redemption: existing, idempotent: true };
    }

    let productCode = input.body.productCode;
    let planCode = input.body.planCode as PlanCode | undefined;
    let durationDays = input.body.durationDays;
    let features = input.body.features ?? {};
    let benefitId = input.body.benefitId ?? null;

    if (input.body.benefitId) {
      const benefit = await this.benefits.findOne({
        where: { id: input.body.benefitId, partnerId: partner.id },
      });
      if (!benefit) throw new EntitlementException("NOT_FOUND", "Benefit not found for partner");
      productCode = benefit.productCode;
      planCode = benefit.planCode;
      durationDays = benefit.durationDays ?? durationDays;
      features = {
        ...(benefit.features as typeof features),
        ...features,
      };
      benefitId = benefit.id;
    }

    if (!productCode || !planCode) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "Provide benefitId or productCode+planCode",
      );
    }

    await assertTrialPlanAllowed(this.products, productCode, planCode);

    const startsAt = new Date();
    const endsAt =
      durationDays != null
        ? new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000)
        : null;

    try {
      const redemption = await this.dataSource.transaction(async (manager) => {
        const raced = await manager.findOne(RedemptionEntity, {
          where: { redemptionId: input.body.redemptionId },
          lock: { mode: "pessimistic_write" },
        });
        if (raced) return { row: raced, created: false as const };

        const sub = await manager.save(
          manager.create(SubscriptionEntity, {
            subjectKind: "USER",
            subjectId: input.body.logtoSub,
            productCode,
            planCode,
            status: "active",
            startsAt,
            endsAt,
            source: "partner",
            sourceRef: input.body.redemptionId,
            organizationId: null,
          }),
        );

        const grant = await manager.save(
          manager.create(GrantEntity, {
            subjectKind: "USER",
            subjectId: input.body.logtoSub,
            productCode,
            planCode,
            features,
            startsAt,
            endsAt,
            source: "partner",
            sourceRef: input.body.redemptionId,
            revoked: false,
          }),
        );

        const row = await manager.save(
          manager.create(RedemptionEntity, {
            redemptionId: input.body.redemptionId,
            partnerId: partner.id,
            benefitId,
            logtoSub: input.body.logtoSub,
            productCode,
            status: "active",
            grantId: grant.id,
            subscriptionId: sub.id,
            startsAt,
            endsAt,
            payload: {
              planCode,
              metadata: input.body.metadata ?? {},
            },
          }),
        );

        // Outbound partner webhook via outbox
        if (partner.webhookUrl) {
          await manager.save(
            manager.create(OutboxEventEntity, {
              eventType: "partner.redemption.created",
              dedupeKey: `partner:${partner.id}:redemption:${row.redemptionId}:created`,
              payload: {
                partnerCode: partner.code,
                partnerId: partner.id,
                redemptionId: row.redemptionId,
                logtoSub: row.logtoSub,
                productCode,
                planCode,
                status: "active",
                webhookUrl: partner.webhookUrl,
              },
              status: "pending",
              scheduledFor: new Date(),
              attempts: 0,
            }),
          );
        }

        return { row, created: true as const };
      });

      // Partner paid grant cancels pending Trial notifications for that user+product (§10).
      if (redemption.created && redemption.row.logtoSub && redemption.row.productCode) {
        await this.dataSource
          .createQueryBuilder()
          .update(OutboxEventEntity)
          .set({ status: "canceled" })
          .where("status IN (:...st)", { st: ["pending", "failed"] })
          .andWhere("event_type IN (:...types)", {
            types: ["trial.expiring", "trial.expired"],
          })
          .andWhere("payload->>'logtoSub' = :sub", { sub: redemption.row.logtoSub })
          .andWhere("payload->>'productCode' = :productCode", {
            productCode: redemption.row.productCode,
          })
          .execute();
      }

      await this.audit.record({
        actor: input.actor,
        action: redemption.created ? "partner.redemption.create" : "partner.redemption.idempotent",
        resourceType: "redemption",
        resourceId: redemption.row.id,
        requestId: input.requestId,
        payload: {
          redemptionId: redemption.row.redemptionId,
          productCode: redemption.row.productCode,
        },
      });

      return { redemption: redemption.row, idempotent: !redemption.created };
    } catch (err) {
      const again = await this.redemptions.findOne({
        where: { redemptionId: input.body.redemptionId },
      });
      if (again) return { redemption: again, idempotent: true };
      throw err;
    }
  }

  async revoke(input: {
    partnerId: string;
    redemptionId: string;
    reason?: string;
    actor: string;
    requestId?: string;
  }) {
    const redemption = await this.redemptions.findOne({
      where: { redemptionId: input.redemptionId, partnerId: input.partnerId },
    });
    if (!redemption) throw new EntitlementException("NOT_FOUND", "Redemption not found");
    if (redemption.status === "revoked") {
      return { redemption, idempotent: true };
    }

    const partner = await this.partners.findOne({ where: { id: input.partnerId } });

    await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(RedemptionEntity, {
        where: { id: redemption.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!locked || locked.status === "revoked") return;
      locked.status = "revoked";
      locked.revokedAt = new Date();
      await manager.save(locked);

      if (locked.grantId) {
        await manager.update(
          GrantEntity,
          { id: locked.grantId },
          { revoked: true, revokedAt: new Date() },
        );
      }
      if (locked.subscriptionId) {
        await manager.update(
          SubscriptionEntity,
          { id: locked.subscriptionId },
          { status: "canceled", canceledAt: new Date() },
        );
      }

      if (partner?.webhookUrl) {
        await manager.save(
          manager.create(OutboxEventEntity, {
            eventType: "partner.redemption.revoked",
            dedupeKey: `partner:${partner.id}:redemption:${locked.redemptionId}:revoked`,
            payload: {
              partnerCode: partner.code,
              partnerId: partner.id,
              redemptionId: locked.redemptionId,
              status: "revoked",
              reason: input.reason ?? null,
              webhookUrl: partner.webhookUrl,
            },
            status: "pending",
            scheduledFor: new Date(),
            attempts: 0,
          }),
        );
      }
    });

    const updated = await this.redemptions.findOneOrFail({ where: { id: redemption.id } });
    await this.audit.record({
      actor: input.actor,
      action: "partner.redemption.revoke",
      resourceType: "redemption",
      resourceId: updated.id,
      reason: input.reason,
      requestId: input.requestId,
    });
    return { redemption: updated, idempotent: false };
  }

  async reconcile(input: {
    partnerId: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const qb = this.redemptions
      .createQueryBuilder("r")
      .where("r.partner_id = :partnerId", { partnerId: input.partnerId })
      .orderBy("r.created_at", "ASC")
      .addOrderBy("r.id", "ASC")
      .take(limit + 1);

    if (input.from) {
      qb.andWhere("r.created_at >= :from", { from: new Date(input.from) });
    }
    if (input.to) {
      qb.andWhere("r.created_at <= :to", { to: new Date(input.to) });
    }
    if (input.cursor) {
      qb.andWhere("r.id > :cursor", { cursor: input.cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => ({
        redemptionId: r.redemptionId,
        status: r.status,
        logtoSub: r.logtoSub,
        productCode: r.productCode,
        startsAt: r.startsAt?.toISOString() ?? null,
        endsAt: r.endsAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    };
  }

  /** Build signed outbound headers for partner webhook delivery. */
  signPartnerWebhook(partner: PartnerEntity, body: string) {
    return this.webhooks.signOutbound(partner, body);
  }
}
