import { Body, Controller, Get, HttpCode, Put, Query, Req, UnauthorizedException } from "@nestjs/common";
import { AI_PRINCIPAL, type AiPrincipal, type AuthedRequest } from "../auth/auth.types";
import { assertInternalService } from "../authz";
import { AiPlatformException } from "../common/errors";
import { AdminService } from "./admin.service";

@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("v1/internal/admin/settings")
  settings(@Req() req: AuthedRequest) {
    assertInternalService(principalOf(req));
    return this.admin.settings();
  }

  @Put("v1/internal/admin/settings/public-api")
  @HttpCode(200)
  setPublicApi(@Body() body: unknown, @Req() req: AuthedRequest) {
    const principal = principalOf(req);
    assertInternalService(principal);
    const input = parsePublicApi(body);
    return this.admin.setPublicApi(input.enabled, principal.subjectId, input.reason);
  }

  @Get("v1/internal/admin/wallets")
  wallets(
    @Query("ownerKind") ownerKind: string | string[] | undefined,
    @Query("ownerId") ownerId: string | string[] | undefined,
    @Req() req: AuthedRequest,
  ) {
    assertInternalService(principalOf(req));
    return this.admin.lookupWallet(one(ownerKind) ?? "", one(ownerId) ?? "");
  }

  @Get("v1/internal/admin/usage")
  usage(
    @Query("from") from: string | string[] | undefined,
    @Query("to") to: string | string[] | undefined,
    @Query("productCode") productCode: string | string[] | undefined,
    @Query("limit") limit: string | string[] | undefined,
    @Req() req: AuthedRequest,
  ) {
    assertInternalService(principalOf(req));
    const toDate = dateOf(one(to), "to", new Date());
    const fromDate = dateOf(one(from), "from", new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000));
    if (fromDate.getTime() > toDate.getTime()) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "from must be before to");
    }
    const code = one(productCode)?.trim() ?? "";
    if (code.length > 64) throw new AiPlatformException("VALIDATION_ERROR", 400, "productCode is too long");
    return this.admin.usage({
      from: fromDate,
      to: toDate,
      productCode: code || null,
      limit: limitOf(one(limit)),
    });
  }

  @Get("v1/internal/admin/rate-cards")
  rateCards(@Req() req: AuthedRequest) {
    assertInternalService(principalOf(req));
    return this.admin.rateCards();
  }

  @Get("v1/internal/admin/connections")
  connections(@Req() req: AuthedRequest) {
    assertInternalService(principalOf(req));
    return this.admin.deploymentConnections();
  }
}

function principalOf(req: AuthedRequest): AiPrincipal {
  const principal = req[AI_PRINCIPAL];
  if (!principal) {
    throw new UnauthorizedException({
      error: { code: "AUTH_REQUIRED", message: "Authentication required" },
    });
  }
  return principal;
}

function parsePublicApi(body: unknown): { enabled: boolean; reason: string | null } {
  const row = record(body);
  if (typeof row.enabled !== "boolean") {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "enabled must be a boolean");
  }
  if (row.reason === undefined || row.reason === null) return { enabled: row.enabled, reason: null };
  if (typeof row.reason !== "string" || row.reason.trim() === "") {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "reason must be a string");
  }
  return { enabled: row.enabled, reason: row.reason.trim() };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "Request body must be an object");
  }
  return value as Record<string, unknown>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function dateOf(value: string | undefined, key: string, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AiPlatformException("VALIDATION_ERROR", 400, `${key} must be an ISO date`);
  }
  return parsed;
}

function limitOf(value: string | undefined): number {
  if (!value) return 100;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "limit must be an integer from 1 to 500");
  }
  return parsed;
}
