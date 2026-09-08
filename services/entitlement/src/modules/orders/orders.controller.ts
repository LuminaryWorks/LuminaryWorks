import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY, REQUEST_RAW_BODY_KEY } from "../../auth/auth.types";
import { CurrentPrincipal, RequireAdmin } from "../../auth/decorators";
import { rejectClientAuthoritativePricing } from "../../common/catalog-pricing";
import { CreateOrderDto } from "../../common/dto";
import { EntitlementException } from "../../common/errors";
import { PaymentGeoService } from "../payments/payment-geo.service";
import { OrdersService } from "./orders.service";

@ApiTags("orders")
@ApiBearerAuth()
@Controller("v1/orders")
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly geo: PaymentGeoService,
  ) {}

  @Get(":id")
  get(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
  ) {
    const subject = this.resolveOrderSubject(principal);
    return this.orders.getOwnedOrder(id, {
      expectedSubjectId: subject.subjectId,
      allowAnyOrder: principal.kind === "admin" || principal.kind === "service",
    });
  }

  @Post()
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateOrderDto,
    @Req()
    req: {
      [REQUEST_ID_KEY]?: string;
      [REQUEST_RAW_BODY_KEY]?: Buffer;
      body?: unknown;
    },
  ) {
    rejectClientAuthoritativePricing(this.rawOrderBody(req));
    const subject = this.resolveOrderSubject(principal);
    return this.orders.createOrder({
      subjectKind: subject.subjectKind,
      subjectId: subject.subjectId,
      offeringId: body.offeringId,
      sku: body.sku,
      productCode: body.productCode,
      interval: body.interval,
      providerHint: body.providerHint,
      returnUrl: body.returnUrl,
      packSku: body.packSku,
      bundleSku: body.bundleSku,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post(":id/pay")
  pay(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req()
    req: {
      [REQUEST_ID_KEY]?: string;
      headers: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
      raw?: { socket?: { remoteAddress?: string } };
    },
  ) {
    const subject = this.resolveOrderSubject(principal);
    const hint = typeof body?.providerHint === "string" ? body.providerHint : undefined;
    return this.orders.payOrder(id, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
      payload: body,
      expectedSubjectId: subject.subjectId,
      allowAnyOrder: principal.kind === "admin" || principal.kind === "service",
      geo: this.geo.resolveFromRequest(req),
      providerHint: hint,
    });
  }

  @Post(":id/complete")
  complete(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: Record<string, unknown> | undefined,
    @Req()
    req: {
      [REQUEST_ID_KEY]?: string;
      headers: Record<string, string | string[] | undefined>;
    },
  ) {
    const subject = this.resolveOrderSubject(principal);
    const headerSig = headerValue(req.headers, "payment-signature");
    // Browser may send paymentRequired/action; core ignores those and uses stored attempt.action.
    return this.orders.completeOrder(id, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
      expectedSubjectId: subject.subjectId,
      allowAnyOrder: principal.kind === "admin" || principal.kind === "service",
      buyerProof: {
        paymentSignature:
          (typeof body?.paymentSignature === "string" ? body.paymentSignature : undefined) ||
          headerSig ||
          null,
        paymentPayload:
          body?.paymentPayload && typeof body.paymentPayload === "object"
            ? (body.paymentPayload as Record<string, unknown>)
            : null,
      },
    });
  }

  /**
   * Dev/manual admin callback. Incapable of live user fulfillment for real
   * providers. Public provider events must use POST /v1/payments/webhooks/:provider/:configId.
   */
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

  private rawOrderBody(req: {
    [REQUEST_RAW_BODY_KEY]?: Buffer;
    body?: unknown;
  }): Record<string, unknown> {
    const raw = req[REQUEST_RAW_BODY_KEY];
    if (Buffer.isBuffer(raw)) {
      const text = raw.toString("utf8").trim();
      if (!text) return {};
      const parsed: unknown = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    }
    return req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
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

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = found?.[1];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
