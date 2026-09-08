import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal, RequireAdmin } from "../../auth/decorators";
import { PaymentGeoService } from "./payment-geo.service";
import { PaymentsService } from "./payments.service";
import { BillingProfileService } from "./billing-profile.service";
import { AdminBillingCountryDto, ManualConfirmDto, RefundOrderDto } from "./payment.dto";

@ApiTags("admin-payments")
@ApiBearerAuth()
@RequireAdmin()
@Controller("v1/admin/payments")
export class PaymentAdminController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly billing: BillingProfileService,
  ) {}

  @Get("orders")
  listOrders(
    @Query("status") status?: string,
    @Query("subjectId") subjectId?: string,
    @Query("productCode") productCode?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.payments.listOrdersAdmin({
      status,
      subjectId,
      productCode,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get("orders/:id")
  getOrder(@Param("id") id: string) {
    return this.payments.getOrderAdmin(id);
  }

  @Get("attempts")
  listAttempts(
    @Query("status") status?: string,
    @Query("orderId") orderId?: string,
    @Query("provider") provider?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.payments.listAttemptsAdmin({
      status,
      orderId,
      provider,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get("attempts/:id")
  getAttempt(@Param("id") id: string) {
    return this.payments.getAttemptAdmin(id);
  }

  @Get("refunds")
  listRefunds(
    @Query("status") status?: string,
    @Query("orderId") orderId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.payments.listRefundsAdmin({
      status,
      orderId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post("orders/:id/manual-confirm")
  confirm(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: ManualConfirmDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.payments.confirmManual({
      orderId: id,
      actor: principal.subjectId,
      reason: body.reason,
      ticket: body.ticket,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post("orders/:id/refund")
  refund(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: RefundOrderDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.payments.refundOrder({
      orderId: id,
      amountCents: body.amountCents,
      idempotencyKey: body.refundIdempotencyKey,
      actor: principal.subjectId,
      reason: body.reason,
      ticket: body.ticket,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post("attempts/:id/reconcile")
  reconcileAttempt(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.payments.reconcileAttempt(id, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post("reconcile")
  reconcilePending(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.payments.reconcilePending({
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post("billing/country")
  overrideBillingCountry(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: AdminBillingCountryDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.billing.upsertCountry({
      subjectKind: body.subjectKind ?? "USER",
      subjectId: body.subjectId,
      country: body.country,
      source: "admin",
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
      reason: body.reason,
      adminOverride: true,
    });
  }
}

@ApiTags("payments")
@ApiBearerAuth()
@Controller("v1/payments")
export class PaymentMethodsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly geo: PaymentGeoService,
  ) {}

  @Get("methods")
  methods(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("currency") currency: string | undefined,
    @Req()
    req: {
      headers: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
      raw?: { socket?: { remoteAddress?: string } };
    },
  ) {
    return this.payments.listMethods({
      subjectKind: "USER",
      subjectId: principal.actAsSubjectId ?? principal.subjectId,
      currency,
      geo: this.geo.resolveFromRequest(req),
    });
  }
}
