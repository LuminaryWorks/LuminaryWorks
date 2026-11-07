import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from "@nestjs/common";
import { AI_PRINCIPAL, type AiPrincipal, type AuthedRequest } from "../auth/auth.types";
import { assertInternalService } from "../authz";
import { AiPlatformException } from "../common/errors";
import { isRateUnit, type RateLine } from "./rate-card";
import {
  amountsToJson,
  WalletService,
  type GrantKind,
  type OwnerKind,
  type WalletCurrency,
} from "./wallet.service";

@Controller()
export class CreditsController {
  constructor(private readonly wallet: WalletService) {}

  @Post("v1/internal/credits/grant")
  @HttpCode(200)
  async grant(@Body() body: unknown, @Req() req: AuthedRequest) {
    assertInternalService(principalOf(req));
    const input = parseGrant(body);
    const result = await this.wallet.grantCredits({
      ownerKind: input.walletOwner.kind,
      ownerId: input.walletOwner.id,
      currency: input.currency,
      kind: input.kind,
      amountMicro: BigInt(input.amountMicro),
      expiresAt: input.expiresAt,
      restrictProductCodes: input.restrictTo?.productCodes ?? null,
      restrictCapabilities: input.restrictTo?.capabilities ?? null,
      sourceType: "order",
      sourceId: input.orderId,
    });
    return amountsToJson({ orderId: input.orderId, ...result });
  }

  @Post("v1/internal/credits/revoke")
  @HttpCode(200)
  async revoke(@Body() body: unknown, @Req() req: AuthedRequest) {
    assertInternalService(principalOf(req));
    const input = parseRevoke(body);
    const result = await this.wallet.revokeBySource(
      "order",
      input.orderId,
      input.amountMicro === undefined ? undefined : BigInt(input.amountMicro),
    );
    return amountsToJson({ orderId: input.orderId, ...result });
  }

  @Post("v1/internal/rate-cards")
  @HttpCode(200)
  async publishRateCard(@Body() body: unknown, @Req() req: AuthedRequest) {
    assertInternalService(principalOf(req));
    const input = parseRateCard(body);
    return this.wallet.publishRateCard({
      id: input.id,
      version: input.version,
      effectiveFrom: input.effectiveFrom,
      lines: input.lines,
    });
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

function parseGrant(body: unknown): {
  orderId: string;
  walletOwner: { kind: OwnerKind; id: string };
  amountMicro: number;
  currency: WalletCurrency;
  expiresAt: Date | null;
  restrictTo?: { productCodes?: string[]; capabilities?: string[] };
  kind: GrantKind;
} {
  const row = record(body);
  const orderId = requiredString(row, "orderId");
  const walletOwner = parseOwner(row.walletOwner);
  const amountMicro = positiveInt(row.amountMicro, "amountMicro");
  const currency = row.currency === undefined ? "USD" : currencyOf(row.currency);
  const kind = row.kind === undefined ? "topup" : kindOf(row.kind);
  const expiresAt = row.expiresAt === undefined || row.expiresAt === null ? null : dateOf(row.expiresAt, "expiresAt");
  const restrictTo = row.restrictTo === undefined ? undefined : parseRestrict(row.restrictTo);
  return { orderId, walletOwner, amountMicro, currency, expiresAt, restrictTo, kind };
}

function parseRevoke(body: unknown): { orderId: string; amountMicro?: number } {
  const row = record(body);
  const orderId = requiredString(row, "orderId");
  if (row.amountMicro === undefined) return { orderId };
  return { orderId, amountMicro: nonNegativeInt(row.amountMicro, "amountMicro") };
}

function parseRateCard(body: unknown): {
  id: string;
  version: number;
  effectiveFrom: Date;
  lines: RateLine[];
} {
  const row = record(body);
  const id = requiredString(row, "id");
  const version = positiveInt(row.version, "version");
  const effectiveFrom = dateOf(row.effectiveFrom, "effectiveFrom");
  if (!Array.isArray(row.lines) || row.lines.length === 0) {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "lines are required");
  }
  const lines = row.lines.map((line) => {
    const item = record(line);
    const unit = requiredString(item, "unit");
    if (!isRateUnit(unit)) throw new AiPlatformException("VALIDATION_ERROR", 400, "unit is invalid");
    return {
      capability: requiredString(item, "capability"),
      providerType: requiredString(item, "providerType"),
      model: requiredString(item, "model"),
      unit,
      upstreamCostMicroUsd: BigInt(nonNegativeInt(item.upstreamCostMicroUsd, "upstreamCostMicroUsd")),
      markupBps: nonNegativeInt(item.markupBps, "markupBps"),
      fixedFeeMicro: BigInt(item.fixedFeeMicro === undefined ? 0 : nonNegativeInt(item.fixedFeeMicro, "fixedFeeMicro")),
    };
  });
  return { id, version, effectiveFrom, lines };
}

function parseOwner(value: unknown): { kind: OwnerKind; id: string } {
  const row = record(value);
  const kind = row.kind;
  if (kind !== "user" && kind !== "organization") {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "walletOwner.kind is invalid");
  }
  return { kind, id: requiredString(row, "id") };
}

function parseRestrict(value: unknown): { productCodes?: string[]; capabilities?: string[] } {
  const row = record(value);
  return {
    productCodes: row.productCodes === undefined ? undefined : stringList(row.productCodes, "productCodes"),
    capabilities: row.capabilities === undefined ? undefined : stringList(row.capabilities, "capabilities"),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "Request body must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new AiPlatformException("VALIDATION_ERROR", 400, `${key} is required`);
  }
  return value.trim();
}

function positiveInt(value: unknown, key: string): number {
  const parsed = nonNegativeInt(value, key);
  if (parsed <= 0) throw new AiPlatformException("VALIDATION_ERROR", 400, `${key} must be positive`);
  return parsed;
}

function nonNegativeInt(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new AiPlatformException("VALIDATION_ERROR", 400, `${key} must be a non-negative integer`);
  }
  return value;
}

function currencyOf(value: unknown): WalletCurrency {
  if (value !== "USD" && value !== "CNY") {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "currency is invalid");
  }
  return value;
}

function kindOf(value: unknown): GrantKind {
  if (value !== "topup" && value !== "subscription" && value !== "promo" && value !== "trial" && value !== "refund_reversal") {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "kind is invalid");
  }
  return value;
}

function dateOf(value: unknown, key: string): Date {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new AiPlatformException("VALIDATION_ERROR", 400, `${key} must be an ISO date`);
  }
  return new Date(value);
}

function stringList(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new AiPlatformException("VALIDATION_ERROR", 400, `${key} must be an array of strings`);
  }
  return value.map((item) => item.trim());
}
