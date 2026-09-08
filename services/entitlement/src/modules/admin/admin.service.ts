import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, type Repository } from "typeorm";
import type { PlanCode, SubjectKind } from "../../common/constants";
import { EntitlementException } from "../../common/errors";
import { assertTrialPlanAllowed } from "../../common/trial-policy";
import { GrantEntity } from "../../database/entities/grant.entity";
import { OrganizationSeatEntity } from "../../database/entities/organization-seat.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { TrialCleanupJobEntity } from "../../database/entities/trial-cleanup-job.entity";
import { PolicyAcceptanceEntity } from "../../database/entities/policy-acceptance.entity";
import { AuditLogEntity } from "../../database/entities/audit-log.entity";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { cancelTrialLifecycle } from "../trials/trial-lifecycle";

@Injectable()
export class AdminService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
    @InjectRepository(GrantEntity)
    private readonly grants: Repository<GrantEntity>,
    @InjectRepository(OrganizationSeatEntity)
    private readonly seats: Repository<OrganizationSeatEntity>,
    @InjectRepository(OutboxEventEntity)
    private readonly outbox: Repository<OutboxEventEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async createGrant(input: {
    subjectKind: SubjectKind;
    subjectId: string;
    productCode: string;
    planCode?: PlanCode;
    features?: GrantEntity["features"];
    startsAt?: string;
    endsAt?: string | null;
    source?: string;
    sourceRef?: string;
    organizationId?: string | null;
    seatLimit?: number;
    actor: string;
    reason?: string;
    requestId?: string;
  }) {
    await assertTrialPlanAllowed(this.products, input.productCode, input.planCode);

    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    const endsAt = input.endsAt === undefined ? null : input.endsAt ? new Date(input.endsAt) : null;

    let subscription: SubscriptionEntity | null = null;
    if (input.planCode) {
      subscription = await this.subscriptions.save(
        this.subscriptions.create({
          subjectKind: input.subjectKind,
          subjectId: input.subjectId,
          productCode: input.productCode,
          planCode: input.planCode,
          status: "active",
          startsAt,
          endsAt,
          source: input.source ?? "manual",
          sourceRef: input.sourceRef ?? null,
          organizationId: input.organizationId ?? null,
        }),
      );
    }

    const grant = await this.grants.save(
      this.grants.create({
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        productCode: input.productCode,
        planCode: input.planCode ?? null,
        features: input.features ?? {},
        startsAt,
        endsAt,
        source: input.source ?? "manual",
        sourceRef: subscription?.id ?? input.sourceRef ?? null,
        organizationId: input.organizationId ?? null,
        revoked: false,
      }),
    );

    if (
      input.subjectKind === "ORGANIZATION" &&
      input.planCode === "enterprise" &&
      input.seatLimit != null
    ) {
      const existing = await this.seats.findOne({
        where: { organizationId: input.subjectId, productCode: input.productCode },
      });
      if (existing) {
        existing.seatLimit = input.seatLimit;
        await this.seats.save(existing);
      } else {
        await this.seats.save(
          this.seats.create({
            organizationId: input.subjectId,
            productCode: input.productCode,
            seatLimit: input.seatLimit,
            seatUsed: 0,
          }),
        );
      }
    }

    // Paid / enterprise / partner-style grants cancel pending Trial notifications and purge (§10).
    if (input.subjectKind === "USER" && input.planCode && input.planCode !== "trial") {
      await this.dataSource.transaction(async (manager) => {
        await cancelTrialLifecycle(manager, input.subjectId, input.productCode);
      });
    }

    await this.audit.record({
      actor: input.actor,
      action: "admin.grant.create",
      resourceType: "grant",
      resourceId: grant.id,
      reason: input.reason,
      requestId: input.requestId,
      payload: {
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        productCode: input.productCode,
        planCode: input.planCode,
      },
    });

    return { grant, subscription };
  }

  async upsertSeats(input: {
    organizationId: string;
    productCode: string;
    seatLimit: number;
    actor: string;
    requestId?: string;
  }) {
    if (input.seatLimit < 0) {
      throw new EntitlementException("VALIDATION_ERROR", "seatLimit must be >= 0");
    }
    let seat = await this.seats.findOne({
      where: { organizationId: input.organizationId, productCode: input.productCode },
    });
    if (!seat) {
      seat = this.seats.create({
        organizationId: input.organizationId,
        productCode: input.productCode,
        seatLimit: input.seatLimit,
        seatUsed: 0,
      });
    } else {
      if (input.seatLimit < seat.seatUsed) {
        throw new EntitlementException("VALIDATION_ERROR", "seatLimit cannot be below seatUsed", {
          details: { seatUsed: seat.seatUsed },
        });
      }
      seat.seatLimit = input.seatLimit;
    }
    seat = await this.seats.save(seat);
    await this.audit.record({
      actor: input.actor,
      action: "admin.seats.upsert",
      resourceType: "organization_seats",
      resourceId: seat.id,
      requestId: input.requestId,
      payload: { seatLimit: seat.seatLimit, seatUsed: seat.seatUsed },
    });
    return seat;
  }

  /** Occupy one seat under pessimistic lock when a member joins an org product. */
  async occupySeat(organizationId: string, productCode: string): Promise<OrganizationSeatEntity> {
    return this.dataSource.transaction(async (manager) => {
      const seat = await manager.findOne(OrganizationSeatEntity, {
        where: { organizationId, productCode },
        lock: { mode: "pessimistic_write" },
      });
      if (!seat) {
        throw new EntitlementException("ENTITLEMENT_REQUIRED", "Organization has no seat pool", {
          productCode,
          details: { organizationId },
        });
      }
      if (seat.seatUsed >= seat.seatLimit) {
        throw new EntitlementException(
          "ENTITLEMENT_SEAT_EXHAUSTED",
          "Organization seats exhausted",
          {
            productCode,
            details: { organizationId, seatLimit: seat.seatLimit, seatUsed: seat.seatUsed },
          },
        );
      }
      seat.seatUsed += 1;
      return manager.save(seat);
    });
  }

  async reconcileGaugeUsage(filter: {
    subjectKind?: SubjectKind;
    subjectId?: string;
    productCode?: string;
    featureCode?: string;
    actor?: string;
    requestId?: string;
  }) {
    const result = await this.entitlements.reconcileGaugeUsage(filter);
    await this.audit.record({
      actor: filter.actor ?? "admin",
      action: "admin.usage.reconcile",
      resourceType: "usage_counters",
      resourceId: filter.productCode ?? "*",
      requestId: filter.requestId,
      payload: {
        rebuilt: result.rebuilt,
        subjectKind: filter.subjectKind,
        subjectId: filter.subjectId,
        productCode: filter.productCode,
        featureCode: filter.featureCode,
      },
    });
    return result;
  }

  async listCleanupJobs(filter: {
    status?: string;
    productCode?: string;
    logtoSub?: string;
    limit?: number;
  }) {
    const jobs = this.dataSource.getRepository(TrialCleanupJobEntity);
    const qb = jobs.createQueryBuilder("j").orderBy("j.scheduled_for", "ASC");
    if (filter.status) {
      qb.andWhere("j.status = :status", { status: filter.status });
    }
    if (filter.productCode) {
      qb.andWhere("j.product_code = :productCode", { productCode: filter.productCode });
    }
    if (filter.logtoSub) {
      qb.andWhere("j.logto_sub = :sub", { sub: filter.logtoSub });
    }
    qb.take(Math.min(Math.max(filter.limit ?? 100, 1), 500));
    return qb.getMany();
  }

  async retryCleanupJob(id: string, actor: string, requestId?: string) {
    const outbox = this.outbox;
    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOne(TrialCleanupJobEntity, { where: { id } });
      if (!job) {
        throw new EntitlementException("NOT_FOUND", "Cleanup job not found");
      }
      if (job.status === "acked") {
        throw new EntitlementException("CONFLICT", "Cleanup job already acknowledged");
      }
      if (job.status === "canceled") {
        throw new EntitlementException("CONFLICT", "Cleanup job was canceled");
      }
      job.status = "pending";
      job.lastError = null;
      job.attempts = 0;
      await manager.save(job);

      if (job.outboxEventId) {
        const event =
          (await manager.findOne(OutboxEventEntity, { where: { id: job.outboxEventId } })) ??
          (await outbox.findOne({ where: { id: job.outboxEventId } }));
        if (event && event.status !== "sent") {
          event.status = "pending";
          event.attempts = 0;
          event.nextAttemptAt = new Date();
          event.lastError = null;
          event.deadLetteredAt = null;
          event.lockedUntil = null;
          event.lockedBy = null;
          await manager.save(event);
        }
      }

      await this.audit.record({
        actor,
        action: "admin.cleanup.retry",
        resourceType: "trial_cleanup_job",
        resourceId: job.id,
        requestId,
        payload: { productCode: job.productCode, logtoSub: job.logtoSub },
      });
      return job;
    });
  }

  async cancelCleanupJob(id: string, actor: string, requestId?: string) {
    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOne(TrialCleanupJobEntity, { where: { id } });
      if (!job) {
        throw new EntitlementException("NOT_FOUND", "Cleanup job not found");
      }
      if (job.status === "acked") {
        throw new EntitlementException("CONFLICT", "Cleanup job already acknowledged");
      }
      job.status = "canceled";
      job.lastError = "canceled_by_admin";
      await manager.save(job);
      if (job.outboxEventId) {
        await manager
          .createQueryBuilder()
          .update(OutboxEventEntity)
          .set({ status: "canceled", lockedUntil: null, lockedBy: null })
          .where("id = :id", { id: job.outboxEventId })
          .andWhere("status IN (:...st)", { st: ["pending", "failed", "processing", "dead"] })
          .execute();
      }
      await this.audit.record({
        actor,
        action: "admin.cleanup.cancel",
        resourceType: "trial_cleanup_job",
        resourceId: job.id,
        requestId,
        payload: { productCode: job.productCode, logtoSub: job.logtoSub },
      });
      return job;
    });
  }

  async listPolicyAcceptances(filter: {
    logtoSub?: string;
    policyVersion?: string;
    limit?: number;
  }) {
    const rows = this.dataSource.getRepository(PolicyAcceptanceEntity);
    const qb = rows.createQueryBuilder("p").orderBy("p.accepted_at", "DESC");
    if (filter.logtoSub) {
      qb.andWhere("p.logto_sub = :sub", { sub: filter.logtoSub });
    }
    if (filter.policyVersion) {
      qb.andWhere("p.policy_version = :version", { version: filter.policyVersion });
    }
    qb.take(Math.min(Math.max(filter.limit ?? 100, 1), 500));
    return qb.getMany();
  }

  async listAudit(filter: {
    actor?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    limit?: number;
  }) {
    const rows = this.dataSource.getRepository(AuditLogEntity);
    const qb = rows.createQueryBuilder("a").orderBy("a.created_at", "DESC");
    if (filter.actor) {
      qb.andWhere("a.actor = :actor", { actor: filter.actor });
    }
    if (filter.action) {
      qb.andWhere("a.action = :action", { action: filter.action });
    }
    if (filter.resourceType) {
      qb.andWhere("a.resource_type = :resourceType", { resourceType: filter.resourceType });
    }
    if (filter.resourceId) {
      qb.andWhere("a.resource_id = :resourceId", { resourceId: filter.resourceId });
    }
    qb.take(Math.min(Math.max(filter.limit ?? 100, 1), 500));
    return qb.getMany();
  }
}
