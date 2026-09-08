import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal, RequireAdmin } from "../../auth/decorators";
import type { ProviderCapabilities } from "../../common/payment-providers";
import {
  CreatePaymentProviderConfigDto,
  RotatePaymentProviderConfigDto,
  UpdatePaymentProviderConfigDto,
} from "./payment.dto";
import { PaymentConfigService } from "./payment-config.service";

@ApiTags("admin-payments")
@ApiBearerAuth()
@RequireAdmin()
@Controller("v1/admin/payments/providers")
export class PaymentConfigAdminController {
  constructor(private readonly configs: PaymentConfigService) {}

  @Get()
  list(
    @Query("providerId") providerId?: string,
    @Query("enabled") enabled?: string,
    @Query("environment") environment?: string,
  ) {
    return this.configs.list({
      providerId,
      enabled: enabled == null ? undefined : enabled === "true",
      environment,
    });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.configs.getPublic(id);
  }

  @Post()
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreatePaymentProviderConfigDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.configs.create({
      providerId: body.providerId,
      environment: body.environment,
      marketScopes: body.marketScopes,
      currencies: body.currencies,
      priority: body.priority,
      capabilities: body.capabilities as Partial<ProviderCapabilities> | undefined,
      merchantId: body.merchantId,
      credentials: body.credentials,
      metadata: body.metadata,
      enabled: body.enabled,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Put(":id")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: UpdatePaymentProviderConfigDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.configs.update(id, {
      ...body,
      capabilities: body.capabilities as Partial<ProviderCapabilities> | undefined,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post(":id/enable")
  enable(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.configs.setEnabled(id, true, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post(":id/disable")
  disable(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.configs.setEnabled(id, false, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post(":id/rotate")
  rotate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: RotatePaymentProviderConfigDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.configs.rotate(id, body.credentials, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post(":id/test")
  test(@Param("id") id: string) {
    return this.configs.testMetadata(id);
  }
}
