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
import { TrialCleanupJobEntity } from "../../database/entities/trial-cleanup-job.entity";
import { TrialRedemptionEntity } from "../../database/entities/trial-redemption.entity";
import { AuditService } from "../audit/audit.service";
import { LegalService } from "../legal/legal.service";
import {
  trialLifecyclePayload,
  trialNotifyDedupeKey,
  trialScheduleAnchors,
} from "./trial-lifecycle";

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
    private readonly legal: LegalService,
  ) {}

  async ensureTrial(input: EnsureTrialInput): Promise<{
    created: boolean;
    subscriptionId: string;
    startsAt: string;
    endsAt: string;
    trialRedemptionId: string | null;
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
        trialRedemptionId: existing.id,
      };
    }

    await this.legal.assertCurrentPolicyAccepted(input.logtoSub);

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
            trialRedemptionId: raced.id,
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

        const redemption = await manager.save(
          manager.create(TrialRedemptionEntity, {
            logtoSub: input.logtoSub,
            productCode: input.productCode,
            subscriptionId: sub.id,
            startsAt,
            endsAt,
          }),
        );

        const policyVersion = this.legal.currentPolicyVersion();
        const payload = trialLifecyclePayload({
          trialRedemptionId: redemption.id,
          subscriptionId: sub.id,
          logtoSub: input.logtoSub,
          productCode: input.productCode,
          startsAt,
          endsAt,
          policyVersion,
        });
        const anchors = trialScheduleAnchors(startsAt, endsAt);

        await manager.save(
          manager.create(OutboxEventEntity, {
            eventType: "trial.expiring",
            dedupeKey: trialNotifyDedupeKey(
              input.logtoSub,
              input.productCode,
              "trial.expiring",
              anchors.t3,
            ),
            payload,
            status: "pending",
            scheduledFor: anchors.t3,
            attempts: 0,
          }),
        );
        await manager.save(
          manager.create(OutboxEventEntity, {
            eventType: "trial.expiring_t1",
            dedupeKey: trialNotifyDedupeKey(
              input.logtoSub,
              input.productCode,
              "trial.expiring_t1",
              anchors.t1,
            ),
            payload,
            status: "pending",
            scheduledFor: anchors.t1,
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
              anchors.expired,
            ),
            payload,
            status: "pending",
            scheduledFor: anchors.expired,
            attempts: 0,
          }),
        );
        const purgeEvent = await manager.save(
          manager.create(OutboxEventEntity, {
            eventType: "trial.purge",
            dedupeKey: trialNotifyDedupeKey(
              input.logtoSub,
              input.productCode,
              "trial.purge",
              anchors.purge,
            ),
            payload,
            status: "pending",
            scheduledFor: anchors.purge,
            attempts: 0,
          }),
        );
        await manager.save(
          manager.create(TrialCleanupJobEntity, {
            trialRedemptionId: redemption.id,
            subscriptionId: sub.id,
            logtoSub: input.logtoSub,
            productCode: input.productCode,
            policyVersion,
            startsAt,
            endsAt,
            scheduledFor: anchors.purge,
            status: "pending",
            attempts: 0,
            lastError: null,
            deliveredAt: null,
            ackedAt: null,
            ackPayload: null,
            outboxEventId: purgeEvent.id,
            organizationId: input.organizationId ?? null,
            deploymentId: input.deploymentId ?? null,
          }),
        );

        return {
          created: true as const,
          subscriptionId: sub.id,
          startsAt,
          endsAt,
          trialRedemptionId: redemption.id,
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
        trialRedemptionId: created.trialRedemptionId,
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
          trialRedemptionId: again.id,
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
    trialRedemptionId: string | null;
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
        trialRedemptionId: existing.id,
        skippedReason: reason,
      };
    }
    return {
      created: false,
      subscriptionId: "",
      startsAt: new Date(0).toISOString(),
      endsAt: new Date(0).toISOString(),
      trialRedemptionId: null,
      skippedReason: reason,
    };
  }
}
