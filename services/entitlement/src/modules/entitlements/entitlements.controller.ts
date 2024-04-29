import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { CurrentPrincipal } from "../../auth/decorators";
import {
  resolveTrustedDeploymentId,
  resolveTrustedOrganizationId,
} from "../../auth/principal-context";
import {
  CheckEntitlementsDto,
  ConsumeEntitlementDto,
  EntitlementsQueryDto,
} from "../../common/dto";
import { EntitlementException } from "../../common/errors";
import { EntitlementsService } from "./entitlements.service";

@ApiTags("entitlements")
@ApiBearerAuth()
@Controller("v1/entitlements")
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get()
  @ApiHeader({ name: "X-Act-As-Subject", required: false })
  async getSnapshot(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: EntitlementsQueryDto,
  ) {
    const deploymentId = resolveTrustedDeploymentId(principal, query.deploymentId);
    const organizationId = resolveTrustedOrganizationId(principal, query.organizationId);
    const ctx = this.resolveSubject(principal, deploymentId);
    return this.entitlements.resolve({
      ...ctx,
      productCode: query.productCode,
      organizationId,
      deploymentId,
    });
  }

  @Post("check")
  @ApiHeader({ name: "X-Act-As-Subject", required: false })
  async check(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CheckEntitlementsDto) {
    const deploymentId = resolveTrustedDeploymentId(principal, body.deploymentId);
    const organizationId = resolveTrustedOrganizationId(principal, body.organizationId);
    const ctx = this.resolveSubject(principal, deploymentId);
    const results = await this.entitlements.check(
      {
        ...ctx,
        productCode: body.productCode,
        organizationId,
        deploymentId,
      },
      body.features,
    );
    return { results };
  }

  @Post("consume")
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiHeader({ name: "X-Act-As-Subject", required: false })
  async consume(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: ConsumeEntitlementDto,
    @Headers("idempotency-key") idempotencyHeader?: string,
  ) {
    const deploymentId = resolveTrustedDeploymentId(principal, body.deploymentId);
    const organizationId = resolveTrustedOrganizationId(principal, body.organizationId);
    const ctx = this.resolveSubject(principal, deploymentId);
    return this.entitlements.consume({
      ctx: {
        ...ctx,
        productCode: body.productCode,
        organizationId,
        deploymentId,
      },
      featureCode: body.featureCode,
      amount: body.amount,
      idempotencyKey: body.idempotencyKey ?? idempotencyHeader,
    });
  }

  /** Occupy one org seat (service/admin). Products call this on member join. */
  @Post("seats/occupy")
  @ApiHeader({ name: "X-Act-As-Subject", required: false })
  async occupySeat(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: { organizationId: string; productCode: string },
  ) {
    if (principal.kind === "user") {
      throw new EntitlementException(
        "FORBIDDEN",
        "Seat occupy requires service or admin credentials",
      );
    }
    const organizationId = resolveTrustedOrganizationId(principal, body.organizationId);
    if (!organizationId) {
      throw new EntitlementException("VALIDATION_ERROR", "organizationId is required");
    }
    if (!body.productCode?.trim()) {
      throw new EntitlementException("VALIDATION_ERROR", "productCode is required");
    }
    return this.entitlements.occupySeat(organizationId, body.productCode.trim());
  }

  /**
   * Subject identity always comes from verified auth — never trust body.subjectId.
   * Service/admin may act for a user only via X-Act-As-Subject.
   */
  private resolveSubject(
    principal: AuthPrincipal,
    deploymentId?: string,
  ): { subjectKind: "USER" | "DEPLOYMENT"; subjectId: string } {
    if (deploymentId && principal.kind === "service" && !principal.actAsSubjectId) {
      return { subjectKind: "DEPLOYMENT", subjectId: deploymentId };
    }
    if (principal.kind === "user") {
      return { subjectKind: "USER", subjectId: principal.subjectId };
    }
    if ((principal.kind === "service" || principal.kind === "admin") && principal.actAsSubjectId) {
      return { subjectKind: "USER", subjectId: principal.actAsSubjectId };
    }
    if (principal.kind === "admin") {
      return { subjectKind: "USER", subjectId: principal.subjectId };
    }
    throw new EntitlementException(
      "FORBIDDEN",
      "Service credential requires X-Act-As-Subject for user entitlement endpoints",
    );
  }
}
