import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { AI_PRINCIPAL, type AiPrincipal, type AuthedRequest } from "../auth/auth.types";
import { AiPlatformException } from "../common/errors";
import { AiUsageEventEntity } from "../database/entities/ai-usage-event.entity";
import { amountsToJson, WalletService } from "../wallet/wallet.service";

const DEFAULT_USAGE_LIMIT = 50;
const MAX_USAGE_LIMIT = 200;

@Controller()
export class MeController {
  constructor(
    private readonly wallets: WalletService,
    @InjectRepository(AiUsageEventEntity)
    private readonly usage: Repository<AiUsageEventEntity>,
  ) {}

  @Get("v1/me/wallet")
  async wallet(@Req() req: AuthedRequest, @Query("subjectId") subjectId?: string) {
    const principal = requireUser(req);
    rejectCallerSubject(subjectId);
    const wallet = await this.wallets.ensureWallet("user", principal.subjectId);
    const balance = await this.wallets.reconciliation(wallet.walletId);
    return amountsToJson({
      walletId: wallet.walletId,
      ownerKind: wallet.ownerKind,
      ownerId: wallet.ownerId,
      currency: wallet.currency,
      status: wallet.status,
      remainingMicro: balance.remainingMicro,
      heldMicro: balance.activeHoldMicro,
      settledMicro: balance.settledMicro,
    });
  }

  @Get("v1/me/grants")
  async grants(@Req() req: AuthedRequest, @Query("subjectId") subjectId?: string) {
    const principal = requireUser(req);
    rejectCallerSubject(subjectId);
    const wallet = await this.wallets.ensureWallet("user", principal.subjectId);
    const rows = await this.wallets.listGrants(wallet.walletId);
    return {
      walletId: wallet.walletId,
      items: rows.map((row) =>
        amountsToJson({
          grantId: row.grantId,
          kind: row.kind,
          amountMicro: row.amountMicro,
          remainingMicro: row.remainingMicro,
          expiresAt: iso(row.expiresAt),
          restrictProductCodes: row.restrictProductCodes,
          restrictCapabilities: row.restrictCapabilities,
          revokedAt: iso(row.revokedAt),
        }),
      ),
    };
  }

  @Get("v1/me/usage")
  async usageEvents(
    @Req() req: AuthedRequest,
    @Query("limit") limitRaw?: string,
    @Query("subjectId") subjectId?: string,
  ) {
    const principal = requireUser(req);
    rejectCallerSubject(subjectId);
    const limit = parseUsageLimit(limitRaw);
    const rows = await this.usage.find({
      where: { subjectId: principal.subjectId },
      order: { at: "DESC" },
      take: limit,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        productCode: row.productCode,
        feature: row.feature,
        purpose: row.purpose,
        providerType: row.providerType,
        model: row.model,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        billed: row.billed,
        status: row.status,
        at: row.at.toISOString(),
        chargedMicro: row.chargedMicro,
        latencyMs: row.latencyMs,
      })),
    };
  }
}

function requireUser(req: AuthedRequest): AiPrincipal {
  const principal = req[AI_PRINCIPAL];
  if (!principal) {
    throw new UnauthorizedException({
      error: { code: "AUTH_REQUIRED", message: "Authentication required" },
    });
  }
  if (principal.kind !== "user") {
    throw new AiPlatformException("FORBIDDEN", 403, "service credentials are not accepted on /v1/me");
  }
  return principal;
}

function rejectCallerSubject(subjectId: string | undefined): void {
  if (subjectId !== undefined) {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "subjectId is not accepted");
  }
}

export function parseUsageLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_USAGE_LIMIT;
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new AiPlatformException("VALIDATION_ERROR", 400, "limit must be an integer");
  }
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_USAGE_LIMIT) {
    throw new AiPlatformException(
      "VALIDATION_ERROR",
      400,
      `limit must be between 1 and ${MAX_USAGE_LIMIT}`,
    );
  }
  return limit;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
