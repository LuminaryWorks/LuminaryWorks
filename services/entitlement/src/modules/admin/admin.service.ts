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
import { AuditService } from "../audit/audit.service";

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

    // Paid / enterprise / partner-style grants cancel pending Trial notifications (§10).
    if (input.subjectKind === "USER" && input.planCode && input.planCode !== "trial") {
      await this.outbox
        .createQueryBuilder()
        .update(OutboxEventEntity)
        .set({ status: "canceled" })
        .where("status IN (:...st)", { st: ["pending", "failed"] })
        .andWhere("event_type IN (:...types)", {
          types: ["trial.expiring", "trial.expired"],
        })
        .andWhere("payload->>'logtoSub' = :sub", { sub: input.subjectId })
        .andWhere("payload->>'productCode' = :productCode", {
          productCode: input.productCode,
        })
        .execute();
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
}
