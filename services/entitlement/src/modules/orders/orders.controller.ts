import { Body, Controller, Param, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal, RequireAdmin } from "../../auth/decorators";
import type { PlanCode } from "../../common/constants";
import { CreateOrderDto } from "../../common/dto";
import { EntitlementException } from "../../common/errors";
import { OrdersService } from "./orders.service";

@ApiTags("orders")
@ApiBearerAuth()
@Controller("v1/orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateOrderDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    const subject = this.resolveOrderSubject(principal);
    return this.orders.createOrder({
      subjectKind: subject.subjectKind,
      subjectId: subject.subjectId,
      productCode: body.productCode,
      planCode: body.planCode as PlanCode | undefined,
      bundleSku: body.bundleSku,
      amountCents: body.amountCents,
      currency: body.currency,
      paymentProvider: body.paymentProvider,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post(":id/pay")
  pay(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    const subject = this.resolveOrderSubject(principal);
    return this.orders.payOrder(id, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
      payload: body,
      // Ownership: users may only pay their own orders; admin/service use act-as subject.
      expectedSubjectId: subject.subjectId,
      allowAnyOrder: principal.kind === "admin" || principal.kind === "service",
    });
  }

  @RequireAdmin()
  @Post("callbacks/:provider")
  callback(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("provider") provider: string,
    @Body() body: Record<string, unknown>,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.orders.handlePayCallback(provider, body, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  private resolveOrderSubject(principal: AuthPrincipal): {
    subjectKind: "USER";
    subjectId: string;
  } {
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
      "Service credential requires X-Act-As-Subject to create orders",
    );
  }
}
