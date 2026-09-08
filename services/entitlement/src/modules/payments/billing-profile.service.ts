import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { SubjectKind } from "../../common/constants";
import { EntitlementException } from "../../common/errors";
import { normalizeCountryCode } from "../../common/payment-geo";
import { BillingProfileEntity } from "../../database/entities/billing-profile.entity";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class BillingProfileService {
  constructor(
    @InjectRepository(BillingProfileEntity)
    private readonly profiles: Repository<BillingProfileEntity>,
    private readonly audit: AuditService,
  ) {}

  async get(subjectKind: SubjectKind, subjectId: string): Promise<BillingProfileEntity | null> {
    return this.profiles.findOne({ where: { subjectKind, subjectId } });
  }

  async upsertCountry(input: {
    subjectKind: SubjectKind;
    subjectId: string;
    country: string;
    source: "user" | "admin" | "geo";
    actor: string;
    requestId?: string;
    reason?: string;
    adminOverride?: boolean;
  }): Promise<BillingProfileEntity> {
    const country = normalizeCountryCode(input.country);
    if (!country) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "country must be an ISO 3166-1 alpha-2 code",
      );
    }
    const existing = await this.profiles.findOne({
      where: { subjectKind: input.subjectKind, subjectId: input.subjectId },
    });
    if (existing?.locked && !input.adminOverride) {
      throw new EntitlementException(
        "CONFLICT",
        "Billing country is immutable after a successful payment; request admin review",
      );
    }
    if (existing) {
      if (input.adminOverride && existing.locked) {
        existing.locked = false;
        existing.lockedAt = null;
        existing.lockedReason = input.reason ?? "admin_review";
      }
      existing.country = country;
      existing.source = input.source;
      await this.profiles.save(existing);
      await this.audit.record({
        actor: input.actor,
        action: "billing_profile.update_country",
        resourceType: "billing_profile",
        resourceId: existing.id,
        requestId: input.requestId,
        reason: input.reason ?? null,
        payload: {
          country,
          source: input.source,
          adminOverride: Boolean(input.adminOverride),
          subjectId: input.subjectId,
        },
      });
      return existing;
    }
    const created = await this.profiles.save(
      this.profiles.create({
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        country,
        source: input.source,
        locked: false,
      }),
    );
    await this.audit.record({
      actor: input.actor,
      action: "billing_profile.create",
      resourceType: "billing_profile",
      resourceId: created.id,
      requestId: input.requestId,
      payload: { country, source: input.source, subjectId: input.subjectId },
    });
    return created;
  }
}
