import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY, REQUEST_RAW_BODY_KEY } from "../../auth/auth.types";
import {
  CurrentPrincipal,
  Public,
  RequireAdmin,
  RequirePartnerScopes,
} from "../../auth/decorators";
import { EntitlementException } from "../../common/errors";
import {
  CreateRedemptionDto,
  OAuthTokenDto,
  PartnerBenefitDto,
  RegisterPartnerDto,
  RevokeRedemptionDto,
} from "./partner.dto";
import { PartnerRedemptionService } from "./partner-redemption.service";
import { PartnerRegistryService } from "./partner-registry.service";
import { PartnerWebhookService } from "./partner-webhook.service";

@ApiTags("oauth")
@Controller("v1/oauth")
export class PartnerOAuthController {
  constructor(private readonly registry: PartnerRegistryService) {}

  /** OAuth2 client_credentials (machine token) for partners. */
  @Public()
  @Post("token")
  @HttpCode(200)
  async token(@Body() body: OAuthTokenDto) {
    if (body.grant_type !== "client_credentials") {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "Only grant_type=client_credentials is supported",
      );
    }
    const result = await this.registry.authenticateClientCredentials({
      clientId: body.client_id,
      clientSecret: body.client_secret,
      scope: body.scope,
    });
    return {
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
      scope: result.scope,
    };
  }
}

@ApiTags("admin-partners")
@ApiBearerAuth()
@RequireAdmin()
@Controller("v1/admin/partners")
export class AdminPartnersController {
  constructor(private readonly registry: PartnerRegistryService) {}

  @Get()
  list() {
    return this.registry.listPartners();
  }

  @Post()
  register(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: RegisterPartnerDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.registry.register({
      ...body,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post(":id/rotate-credentials")
  rotate(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.registry.rotateCredentials(id, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post(":id/benefits")
  addBenefit(
    @Param("id") id: string,
    @Body() body: PartnerBenefitDto,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.registry.addBenefit(id, body, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }
}

@ApiTags("partner")
@ApiBearerAuth()
@Controller("v1/partner")
export class PartnerController {
  constructor(
    private readonly redemptions: PartnerRedemptionService,
    private readonly webhooks: PartnerWebhookService,
  ) {}

  @Post("redemptions")
  @RequirePartnerScopes("partner:redeem")
  createRedemption(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateRedemptionDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    const partnerId = this.requirePartnerId(principal);
    return this.redemptions.redeem({
      partnerId,
      body,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post("redemptions/:redemptionId/revoke")
  @RequirePartnerScopes("partner:revoke")
  revoke(
    @Param("redemptionId") redemptionId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: RevokeRedemptionDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    const partnerId = this.requirePartnerId(principal);
    return this.redemptions.revoke({
      partnerId,
      redemptionId,
      reason: body.reason,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Get("redemptions")
  @RequirePartnerScopes("partner:reconcile")
  reconcile(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const partnerId = this.requirePartnerId(principal);
    return this.redemptions.reconcile({
      partnerId,
      from,
      to,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * Inbound partner callback — signature + timestamp + nonce replay protection.
   * Uses raw body for HMAC; must not re-serialize JSON before verify.
   */
  @Public()
  @Post("callbacks/:partnerCode")
  @HttpCode(200)
  async inboundCallback(
    @Param("partnerCode") partnerCode: string,
    @Headers("x-lw-timestamp") timestamp: string | undefined,
    @Headers("x-lw-nonce") nonce: string | undefined,
    @Headers("x-lw-signature") signature: string | undefined,
    @Body() body: Record<string, unknown>,
    @Req()
    req: {
      [REQUEST_RAW_BODY_KEY]?: Buffer;
      body?: unknown;
    },
  ) {
    const raw = req[REQUEST_RAW_BODY_KEY] ?? Buffer.from(JSON.stringify(body ?? {}), "utf8");
    const partner = await this.webhooks.verifyInbound({
      partnerCode,
      timestamp,
      nonce,
      signature,
      rawBody: raw,
    });
    // Acknowledge only — business handlers can extend via event_type in body
    return {
      ok: true,
      partnerCode: partner.code,
      received: typeof body?.event_type === "string" ? body.event_type : "unknown",
    };
  }

  private requirePartnerId(principal: AuthPrincipal): string {
    if (principal.kind === "partner" && principal.partnerId) return principal.partnerId;
    if (principal.kind === "service" || principal.kind === "admin") {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "Service/admin must use partner token for partner APIs (or act via admin partner tools)",
      );
    }
    throw new EntitlementException("FORBIDDEN", "Partner credential required");
  }
}
