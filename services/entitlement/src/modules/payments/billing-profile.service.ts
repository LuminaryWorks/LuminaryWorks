import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import {
  assertBillingProfileComplete,
  isPayerType,
  type PayerType,
} from "../../common/billing-profile";
import type { SubjectKind } from "../../common/constants";
import { EntitlementException } from "../../common/errors";
import { normalizeCountryCode } from "../../common/payment-geo";
import { BillingProfileEntity } from "../../database/entities/billing-profile.entity";
import { AuditService } from "../audit/audit.service";

export function publicBillingProfile(profile: BillingProfileEntity | null): {
  country: string | null;
  payerType: PayerType;
  companyName: string | null;
  taxId: string | null;
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  locked: boolean;
  source: string | null;
} {
  return {
    country: profile?.country ?? null,
    payerType: profile?.payerType ?? "individual",
    companyName: profile?.companyName ?? null,
    taxId: profile?.taxId ?? null,
    addressLine1: profile?.addressLine1 ?? null,
    city: profile?.city ?? null,
    postalCode: profile?.postalCode ?? null,
    locked: profile?.locked ?? false,
    source: profile?.source ?? null,
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

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
      assertBillingProfileComplete(existing);
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
    const created = this.profiles.create({
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      country,
      payerType: "individual",
      source: input.source,
      locked: false,
    });
    assertBillingProfileComplete(created);
    await this.profiles.save(created);
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

  async upsertProfile(input: {
    subjectKind: SubjectKind;
    subjectId: string;
    payerType?: PayerType;
    companyName?: string | null;
    taxId?: string | null;
    addressLine1?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string | null;
    source: "user" | "admin" | "geo";
    actor: string;
    requestId?: string;
    reason?: string;
    adminOverride?: boolean;
  }): Promise<BillingProfileEntity> {
    if (input.payerType != null && !isPayerType(input.payerType)) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "payerType must be individual or business",
      );
    }
    let country: string | undefined;
    if (input.country != null && input.country.trim() !== "") {
      const normalized = normalizeCountryCode(input.country);
      if (!normalized) {
        throw new EntitlementException(
          "VALIDATION_ERROR",
          "country must be an ISO 3166-1 alpha-2 code",
        );
      }
      country = normalized;
    }
    const existing = await this.profiles.findOne({
      where: { subjectKind: input.subjectKind, subjectId: input.subjectId },
    });
    if (existing?.locked && country && country !== existing.country && !input.adminOverride) {
      throw new EntitlementException(
        "CONFLICT",
        "Billing country is immutable after a successful payment; request admin review",
      );
    }
    if (existing) {
      if (input.adminOverride && existing.locked && country && country !== existing.country) {
        existing.locked = false;
        existing.lockedAt = null;
        existing.lockedReason = input.reason ?? "admin_review";
      }
      if (input.payerType) existing.payerType = input.payerType;
      if (input.companyName !== undefined) existing.companyName = emptyToNull(input.companyName);
      if (input.taxId !== undefined) existing.taxId = emptyToNull(input.taxId);
      if (input.addressLine1 !== undefined) {
        existing.addressLine1 = emptyToNull(input.addressLine1);
      }
      if (input.city !== undefined) existing.city = emptyToNull(input.city);
      if (input.postalCode !== undefined) existing.postalCode = emptyToNull(input.postalCode);
      if (country) existing.country = country;
      existing.source = input.source;
      assertBillingProfileComplete(existing);
      await this.profiles.save(existing);
      await this.audit.record({
        actor: input.actor,
        action: "billing_profile.update",
        resourceType: "billing_profile",
        resourceId: existing.id,
        requestId: input.requestId,
        reason: input.reason ?? null,
        payload: {
          payerType: existing.payerType,
          country: existing.country,
          subjectId: input.subjectId,
        },
      });
      return existing;
    }
    const payerType = input.payerType ?? "individual";
    if (!country) {
      if (payerType === "business") {
        throw new EntitlementException(
          "PAYMENT_BILLING_PROFILE_INCOMPLETE",
          "Business billing profiles require companyName and country",
        );
      }
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "country must be an ISO 3166-1 alpha-2 code",
      );
    }
    const created = this.profiles.create({
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      country,
      payerType,
      companyName: emptyToNull(input.companyName),
      taxId: emptyToNull(input.taxId),
      addressLine1: emptyToNull(input.addressLine1),
      city: emptyToNull(input.city),
      postalCode: emptyToNull(input.postalCode),
      source: input.source,
      locked: false,
    });
    assertBillingProfileComplete(created);
    await this.profiles.save(created);
    await this.audit.record({
      actor: input.actor,
      action: "billing_profile.create",
      resourceType: "billing_profile",
      resourceId: created.id,
      requestId: input.requestId,
      payload: { country, payerType, source: input.source, subjectId: input.subjectId },
    });
    return created;
  }
}
