import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal, RequireAdmin } from "../../auth/decorators";
import { AdminGrantDto, ReconcileGaugeUsageDto } from "../../common/dto";
import { AdminService } from "./admin.service";

@ApiTags("admin")
@ApiBearerAuth()
@RequireAdmin()
@Controller("v1/admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post("grants")
  createGrant(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: AdminGrantDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.admin.createGrant({
      subjectKind: body.subjectKind,
      subjectId: body.subjectId,
      productCode: body.productCode,
      planCode: body.planCode,
      features: body.features,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      seatLimit: body.seatLimit,
      actor: principal.subjectId,
      reason: body.reason,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post("seats")
  upsertSeats(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body()
    body: { organizationId: string; productCode: string; seatLimit: number },
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.admin.upsertSeats({
      organizationId: body.organizationId,
      productCode: body.productCode,
      seatLimit: body.seatLimit,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  /** Occupy one seat when a member joins an org product context. */
  @Post("seats/occupy")
  occupySeat(@Body() body: { organizationId: string; productCode: string }) {
    return this.admin.occupySeat(body.organizationId, body.productCode);
  }

  /** Rebuild gauge usage_counters from resource_allocations. */
  @Post("usage/reconcile")
  reconcileGaugeUsage(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: ReconcileGaugeUsageDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.admin.reconcileGaugeUsage({
      ...body,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Get("cleanup-jobs")
  listCleanupJobs(
    @Query("status") status?: string,
    @Query("productCode") productCode?: string,
    @Query("logtoSub") logtoSub?: string,
  ) {
    return this.admin.listCleanupJobs({ status, productCode, logtoSub });
  }

  @Post("cleanup-jobs/:id/retry")
  retryCleanupJob(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.admin.retryCleanupJob(id, principal.subjectId, req[REQUEST_ID_KEY]);
  }

  @Post("cleanup-jobs/:id/cancel")
  cancelCleanupJob(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.admin.cancelCleanupJob(id, principal.subjectId, req[REQUEST_ID_KEY]);
  }

  @Get("policy-acceptances")
  listPolicyAcceptances(
    @Query("logtoSub") logtoSub?: string,
    @Query("policyVersion") policyVersion?: string,
  ) {
    return this.admin.listPolicyAcceptances({ logtoSub, policyVersion });
  }

  @Get("audit")
  listAudit(
    @Query("actor") actor?: string,
    @Query("action") action?: string,
    @Query("resourceType") resourceType?: string,
    @Query("resourceId") resourceId?: string,
  ) {
    return this.admin.listAudit({ actor, action, resourceType, resourceId });
  }
}
