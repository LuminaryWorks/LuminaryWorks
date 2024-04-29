import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, type Repository } from "typeorm";
import { TRIAL_DURATION_MS } from "../../common/constants";
import { assertTrialPlanAllowed } from "../../common/trial-policy";
import { GrantEntity } from "../../database/entities/grant.entity";
import { LicenseEntity } from "../../database/entities/license.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { TrialRedemptionEntity } from "../../database/entities/trial-redemption.entity";
import { AuditService } from "../audit/audit.service";
import { trialNotifyDedupeKey } from "../notify/outbox-policy";

export interface EnsureTrialInput {
  logtoSub: string;
  productCode: string;
  organizationId?: string | null;
  deploymentId?: string | null;
  actor: string;
  requestId?: string | null;
}

@Injectable()
export class TrialsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(TrialRedemptionEntity)
    private readonly redemptions: Repository<TrialRedemptionEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
    @InjectRepository(LicenseEntity)
    private readonly licenses: Repository<LicenseEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    private readonly audit: AuditService,
  ) {}

  async ensureTrial(input: EnsureTrialInput): Promise<{
    created: boolean;
    subscriptionId: string;
    startsAt: string;
    endsAt: string;
    skippedReason?: string;
  }> {
    await assertTrialPlanAllowed(this.products, input.productCode, "trial");

    if (input.deploymentId) {
      const lic = await this.licenses.findOne({
        where: { deploymentId: input.deploymentId, active: true },
      });
      if (lic) {
        return this.existingOrSkip(input, "DEPLOYMENT_LICENSE");
      }
    }

    if (input.organizationId) {
      const orgEnterprise = await this.subscriptions.findOne({
        where: {
          subjectKind: "ORGANIZATION",
          subjectId: input.organizationId,
          productCode: input.productCode,
          planCode: "enterprise",
          status: "active",
        },
      });
      if (orgEnterprise) {
        const asOf = new Date();
        if (
          orgEnterprise.startsAt <= asOf &&
          (orgEnterprise.endsAt == null || orgEnterprise.endsAt > asOf)
        ) {
          return this.existingOrSkip(input, "ORGANIZATION_ENTERPRISE");
        }
      }
    }

    const existing = await this.redemptions.findOne({
      where: { logtoSub: input.logtoSub, productCode: input.productCode },
    });
    if (existing) {
      return {
        created: false,
        subscriptionId: existing.subscriptionId,
        startsAt: existing.startsAt.toISOString(),
        endsAt: existing.endsAt.toISOString(),
      };
    }

    try {
      const created = await this.dataSource.transaction(async (manager) => {
        // Advisory lock + unique (logto_sub, product_code) for concurrency-safe once-only trial
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `trial:${input.logtoSub}:${input.productCode}`,
        ]);
        const raced = await manager.findOne(TrialRedemptionEntity, {
          where: { logtoSub: input.logtoSub, productCode: input.productCode },
          lock: { mode: "pessimistic_write" },
        });
        if (raced) {
          return {
            created: false as const,
            subscriptionId: raced.subscriptionId,
            startsAt: raced.startsAt,
            endsAt: raced.endsAt,
          };
        }

        const startsAt = new Date();
        const endsAt = new Date(startsAt.getTime() + TRIAL_DURATION_MS);
        const sub = await manager.save(
          manager.create(SubscriptionEntity, {
            subjectKind: "USER",
            subjectId: input.logtoSub,
            productCode: input.productCode,
            planCode: "trial",
            status: "active",
            startsAt,
            endsAt,
            source: "trial",
            sourceRef: null,
            organizationId: null,
          }),
        );

        await manager.save(
          manager.create(GrantEntity, {
            subjectKind: "USER",
            subjectId: input.logtoSub,
            productCode: input.productCode,
            planCode: "trial",
            features: {},
            startsAt,
            endsAt,
            source: "trial",
            sourceRef: sub.id,
            revoked: false,
          }),
        );

        await manager.save(
          manager.create(TrialRedemptionEntity, {
            logtoSub: input.logtoSub,
            productCode: input.productCode,
            subscriptionId: sub.id,
            startsAt,
            endsAt,
          }),
        );

        const t3 = new Date(endsAt.getTime() - 3 * 24 * 60 * 60 * 1000);
        await manager.save(
          manager.create(OutboxEventEntity, {
            eventType: "trial.expiring",
            dedupeKey: trialNotifyDedupeKey(
              input.logtoSub,
              input.productCode,
              "trial.expiring",
              t3,
            ),
            payload: {
              logtoSub: input.logtoSub,
              productCode: input.productCode,
              subscriptionId: sub.id,
              endsAt: endsAt.toISOString(),
            },
            status: "pending",
            scheduledFor: t3 > startsAt ? t3 : startsAt,
            attempts: 0,
          }),
        );
        await manager.save(
          manager.create(OutboxEventEntity, {
            eventType: "trial.expired",
            dedupeKey: trialNotifyDedupeKey(
              input.logtoSub,
              input.productCode,
              "trial.expired",
              endsAt,
            ),
            payload: {
              logtoSub: input.logtoSub,
              productCode: input.productCode,
              subscriptionId: sub.id,
              endsAt: endsAt.toISOString(),
            },
            status: "pending",
            scheduledFor: endsAt,
            attempts: 0,
          }),
        );

        return {
          created: true as const,
          subscriptionId: sub.id,
          startsAt,
          endsAt,
        };
      });

      await this.audit.record({
        actor: input.actor,
        action: created.created ? "trial.ensure.create" : "trial.ensure.idempotent",
        resourceType: "subscription",
        resourceId: created.subscriptionId,
        requestId: input.requestId,
        payload: { productCode: input.productCode, logtoSub: input.logtoSub },
      });

      return {
        created: created.created,
        subscriptionId: created.subscriptionId,
        startsAt: created.startsAt.toISOString(),
        endsAt: created.endsAt.toISOString(),
      };
    } catch (err) {
      // Unique violation race → return existing
      const again = await this.redemptions.findOne({
        where: { logtoSub: input.logtoSub, productCode: input.productCode },
      });
      if (again) {
        return {
          created: false,
          subscriptionId: again.subscriptionId,
          startsAt: again.startsAt.toISOString(),
          endsAt: again.endsAt.toISOString(),
        };
      }
      throw err;
    }
  }

  private async existingOrSkip(
    input: EnsureTrialInput,
    reason: string,
  ): Promise<{
    created: boolean;
    subscriptionId: string;
    startsAt: string;
    endsAt: string;
    skippedReason?: string;
  }> {
    const existing = await this.redemptions.findOne({
      where: { logtoSub: input.logtoSub, productCode: input.productCode },
    });
    if (existing) {
      return {
        created: false,
        subscriptionId: existing.subscriptionId,
        startsAt: existing.startsAt.toISOString(),
        endsAt: existing.endsAt.toISOString(),
        skippedReason: reason,
      };
    }
    return {
      created: false,
      subscriptionId: "",
      startsAt: new Date(0).toISOString(),
      endsAt: new Date(0).toISOString(),
      skippedReason: reason,
    };
  }
}
