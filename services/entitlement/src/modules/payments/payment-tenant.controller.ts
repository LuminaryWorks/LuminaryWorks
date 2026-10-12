import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal, RequireTenantCommerce } from "../../auth/decorators";
import { EntitlementException } from "../../common/errors";
import type { ProviderCapabilities } from "../../common/payment-providers";
import {
  CreatePaymentProviderConfigDto,
  ReorderPaymentProvidersDto,
  RotatePaymentProviderConfigDto,
  UpdatePaymentProviderConfigDto,
} from "./payment.dto";
import { PaymentConfigService } from "./payment-config.service";

function tenantIdOf(principal: AuthPrincipal): string {
  const tenantId = principal.organizationId?.trim();
  if (!tenantId) {
    throw new EntitlementException("FORBIDDEN", "Tenant commerce scope required");
  }
  return tenantId;
}

@ApiTags("tenant-payments")
@ApiBearerAuth()
@RequireTenantCommerce()
@Controller("v1/tenant/payments/providers")
export class PaymentTenantController {
  constructor(private readonly configs: PaymentConfigService) {}

  @Get()
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("providerId") providerId?: string,
    @Query("enabled") enabled?: string,
    @Query("environment") environment?: string,
  ) {
    return this.configs.list(
      {
        providerId,
        enabled: enabled == null ? undefined : enabled === "true",
        environment,
      },
      tenantIdOf(principal),
    );
  }

  @Post("reorder")
  reorder(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: ReorderPaymentProvidersDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    const tenantId = tenantIdOf(principal);
    return this.configs.reorder(body.providerIds, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
      tenantId,
    });
  }

  @Get(":id")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.configs.getPublic(id, tenantIdOf(principal));
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
      enabled: false,
      tenantId: tenantIdOf(principal),
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
      tenantId: tenantIdOf(principal),
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
      tenantId: tenantIdOf(principal),
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
      tenantId: tenantIdOf(principal),
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
      tenantId: tenantIdOf(principal),
    });
  }

  @Post(":id/test")
  test(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.configs.testMetadata(id, tenantIdOf(principal));
  }
}
