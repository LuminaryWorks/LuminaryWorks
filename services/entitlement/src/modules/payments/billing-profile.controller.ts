import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal } from "../../auth/decorators";
import { EntitlementException } from "../../common/errors";
import { BillingProfileService } from "./billing-profile.service";
import { BillingCountryDto } from "./payment.dto";

@ApiTags("billing")
@ApiBearerAuth()
@Controller("v1/billing")
export class BillingProfileController {
  constructor(private readonly billing: BillingProfileService) {}

  @Get("profile")
  async get(@CurrentPrincipal() principal: AuthPrincipal) {
    const subject = this.subject(principal);
    const profile = await this.billing.get(subject.subjectKind, subject.subjectId);
    return {
      subjectKind: subject.subjectKind,
      subjectId: subject.subjectId,
      country: profile?.country ?? null,
      locked: profile?.locked ?? false,
      source: profile?.source ?? null,
    };
  }

  @Put("country")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: BillingCountryDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    const subject = this.subject(principal);
    return this.billing.upsertCountry({
      subjectKind: subject.subjectKind,
      subjectId: subject.subjectId,
      country: body.country,
      source: principal.kind === "admin" ? "admin" : "user",
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
      adminOverride: principal.kind === "admin" || principal.kind === "service",
    });
  }

  private subject(principal: AuthPrincipal): { subjectKind: "USER"; subjectId: string } {
    if (principal.kind === "user") {
      return { subjectKind: "USER", subjectId: principal.subjectId };
    }
    if (principal.actAsSubjectId) {
      return { subjectKind: "USER", subjectId: principal.actAsSubjectId };
    }
    if (principal.kind === "admin") {
      return { subjectKind: "USER", subjectId: principal.subjectId };
    }
    throw new EntitlementException(
      "FORBIDDEN",
      "Service credential requires X-Act-As-Subject to manage billing country",
    );
  }
}
