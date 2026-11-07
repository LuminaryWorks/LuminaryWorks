import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { AiPlatformException } from "../common/errors";
import { isUniqueViolation, microToNumber } from "./money";
import { isRateUnit, priceUsage, type RateLine, type UsageQuantities } from "./rate-card";
import { grantsForSpend, type SpendContext, type SpendGrant } from "./spend-order";

export const HOLD_TTL_MS = 15 * 60 * 1000;
const OVERRUN_PARTIAL_BPS = 2000n;

export type OwnerKind = "user" | "organization";
export type WalletCurrency = "USD" | "CNY";
export type GrantKind = "topup" | "subscription" | "promo" | "trial" | "refund_reversal";
export type GrantSourceType = "order" | "subscription_period" | "admin" | "promo";

export interface WalletRecord {
  walletId: string;
  ownerKind: OwnerKind;
  ownerId: string;
  currency: WalletCurrency;
  status: "active" | "frozen" | "closed";
}

export interface GrantCreditsInput {
  ownerKind: OwnerKind;
  ownerId: string;
  currency?: WalletCurrency;
  kind: GrantKind;
  amountMicro: bigint;
  expiresAt?: Date | null;
  restrictProductCodes?: string[] | null;
  restrictCapabilities?: string[] | null;
  sourceType: GrantSourceType;
  sourceId: string;
}

export interface GrantResult {
  grantId: string;
  walletId: string;
  amountMicro: bigint;
  remainingMicro: bigint;
  created: boolean;
}

export interface ReserveInput {
  requestId: string;
  walletId: string;
  estimateMicro: bigint;
  productCode: string;
  capability: string;
  ttlMs?: number;
}

export interface ReserveResult {
  requestId: string;
  holdId: string;
  walletId: string;
  amountMicro: bigint;
  status: string;
  created: boolean;
}

export interface SettleInput {
  requestId: string;
  capability: string;
  providerType: string;
  model: string;
  usage: UsageQuantities;
}

export interface Settlement {
  requestId: string;
  walletId: string;
  chargedMicro: bigint;
  overrunMicro: bigint;
  upstreamCostMicroUsd: bigint;
  rateCardId: string;
  rateCardVersion: number;
  grantIds: string[];
  partial: boolean;
  idempotent: boolean;
}

export interface ReleaseResult {
  requestId: string;
  status: string;
  releasedMicro: bigint;
  idempotent: boolean;
  transitioned: boolean;
}

export interface RevokeResult {
  grantId: string;
  walletId: string;
  recoveredMicro: bigint;
  shortfallMicro: bigint;
  remainingMicro: bigint;
  idempotent: boolean;
}

export interface Reconciliation {
  grantedMicro: bigint;
  remainingMicro: bigint;
  activeHoldMicro: bigint;
  settledMicro: bigint;
  revokedMicro: bigint;
}

interface GrantRow extends SpendGrant {
  walletId: string;
  amountMicro: bigint;
  sourceType: string;
  sourceId: string;
  revokedMicro: bigint;
  revokeShortfallMicro: bigint;
  revokedAt: Date | null;
}

interface HoldRow {
  holdId: string;
  walletId: string;
  requestId: string;
  amountMicro: bigint;
  status: "pending" | "settled" | "released" | "expired";
  productCode: string | null;
  capability: string | null;
  settledMicro: bigint | null;
  overrunMicro: bigint | null;
  upstreamCostMicroUsd: bigint | null;
  rateCardId: string | null;
  rateCardVersion: number | null;
  partial: boolean | null;
}

interface CardSnapshot {
  id: string;
  version: number;
  lines: RateLine[];
}

/**
 * Credit ledger. Lock order is always wallet, then grants by grant_id, then the hold.
 * ledger_entries is insert-only; the database trigger rejects UPDATE and DELETE.
 */
@Injectable()
export class WalletService {
  constructor(private readonly dataSource: DataSource) {}

  async ensureWallet(
    ownerKind: OwnerKind,
    ownerId: string,
    currency: WalletCurrency = "USD",
  ): Promise<WalletRecord> {
    if (ownerKind !== "user" && ownerKind !== "organization") {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "ownerKind is invalid");
    }
    if (!ownerId.trim()) throw new AiPlatformException("VALIDATION_ERROR", 400, "ownerId is required");
    if (currency !== "USD" && currency !== "CNY") {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "currency is invalid");
    }
    return this.dataSource.transaction(async (manager) => this.ensureWalletTx(manager, ownerKind, ownerId, currency));
  }

  async grantCredits(input: GrantCreditsInput): Promise<GrantResult> {
    this.assertGrant(input);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const wallet = await this.ensureWalletTx(
          manager,
          input.ownerKind,
          input.ownerId,
          input.currency ?? "USD",
        );
        const grantId = id("gr");
        await manager.query(
          `INSERT INTO credit_grants (
             grant_id, wallet_id, kind, amount_micro, remaining_micro, expires_at,
             restrict_product_codes, restrict_capabilities, source_type, source_id
           ) VALUES ($1,$2,$3,$4,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
          [
            grantId,
            wallet.walletId,
            input.kind,
            input.amountMicro.toString(),
            input.expiresAt ?? null,
            jsonOrNull(input.restrictProductCodes),
            jsonOrNull(input.restrictCapabilities),
            input.sourceType,
            input.sourceId,
          ],
        );
        await this.insertLedger(manager, {
          walletId: wallet.walletId,
          grantId,
          kind: "grant",
          amountMicro: input.amountMicro,
          requestId: input.sourceId,
          meta: { sourceType: input.sourceType, sourceId: input.sourceId, kind: input.kind },
        });
        return {
          grantId,
          walletId: wallet.walletId,
          amountMicro: input.amountMicro,
          remainingMicro: input.amountMicro,
          created: true,
        };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.replayGrant(input);
    }
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const requestId = input.requestId.trim();
    if (!requestId) throw new AiPlatformException("VALIDATION_ERROR", 400, "requestId is required");
    if (input.estimateMicro < 0n) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "estimateMicro must be >= 0");
    }
    const productCode = input.productCode.trim();
    const capability = input.capability.trim();
    if (!productCode || !capability) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "productCode and capability are required");
    }
    return this.dataSource.transaction(async (manager) => {
      const walletId = await this.walletIdForRequest(manager, requestId, input.walletId);
      const wallet = await this.lockWallet(manager, walletId);
      const existing = await this.lockHold(manager, requestId);
      if (existing) return this.replayReserve(existing, input);
      if (wallet.status !== "active") {
        throw new AiPlatformException("FORBIDDEN", 403, "wallet is not active");
      }
      const now = new Date();
      const ctx: SpendContext = { productCode, capability, now };
      const plan = await this.planDraw(manager, wallet.walletId, ctx, input.estimateMicro, false);
      const holdId = id("hold");
      const expiresAt = new Date(now.getTime() + (input.ttlMs ?? HOLD_TTL_MS));
      await manager.query(
        `INSERT INTO credit_holds (
           hold_id, wallet_id, request_id, amount_micro, status, expires_at, product_code, capability
         ) VALUES ($1,$2,$3,$4,'pending',$5,$6,$7)`,
        [holdId, wallet.walletId, requestId, input.estimateMicro.toString(), expiresAt, productCode, capability],
      );
      await this.applyDraw(manager, {
        walletId: wallet.walletId,
        holdId,
        requestId,
        plan,
        ledgerKind: "reserve",
      });
      return {
        requestId,
        holdId,
        walletId: wallet.walletId,
        amountMicro: input.estimateMicro,
        status: "pending",
        created: true,
      };
    });
  }

  async settle(input: SettleInput): Promise<Settlement> {
    const requestId = input.requestId.trim();
    if (!requestId) throw new AiPlatformException("VALIDATION_ERROR", 400, "requestId is required");
    return this.dataSource.transaction(async (manager) => {
      const walletId = await this.walletIdForRequest(manager, requestId, null);
      await this.lockWallet(manager, walletId);
      const hold = await this.lockHold(manager, requestId);
      if (!hold) throw new AiPlatformException("VALIDATION_ERROR", 400, "unknown requestId");
      if (hold.status === "settled") return this.settlementFromHold(manager, hold, true);
      if (hold.status !== "pending") {
        throw new AiPlatformException("VALIDATION_ERROR", 400, "hold is not pending");
      }
      const capability = input.capability.trim() || hold.capability || "";
      const productCode = hold.productCode || "";
      const card = await this.loadEffectiveCard(manager, new Date());
      let quote;
      try {
        quote = priceUsage(card, capability, input.providerType, input.model, input.usage);
      } catch (error) {
        throw new AiPlatformException(
          "VALIDATION_ERROR",
          400,
          error instanceof Error ? error.message : "rate card lookup failed",
        );
      }
      if (quote.usedFallback) {
        console.warn(
          `ai-platform rate card fallback ${card.id}@${card.version} ${capability}/${input.providerType}/${input.model}`,
        );
      }
      const actual = quote.chargedMicro;
      let charged = actual;
      let overrun = 0n;
      if (actual <= hold.amountMicro) {
        await this.restoreAmount(manager, hold.holdId, hold.amountMicro - actual, {
          walletId: hold.walletId,
          requestId,
          kind: "release",
        });
      } else {
        const extra = actual - hold.amountMicro;
        const now = new Date();
        const plan = await this.planDraw(
          manager,
          hold.walletId,
          { productCode, capability, now },
          extra,
          true,
        );
        await this.applyDraw(manager, {
          walletId: hold.walletId,
          holdId: hold.holdId,
          requestId,
          plan,
          ledgerKind: "reserve",
        });
        charged = hold.amountMicro + plan.drawn;
        overrun = actual - charged;
      }
      const partial = overrun * 10_000n > hold.amountMicro * OVERRUN_PARTIAL_BPS;
      await manager.query(
        `UPDATE credit_holds
         SET status = 'settled', settled_micro = $2, overrun_micro = $3,
             upstream_cost_micro_usd = $4, rate_card_id = $5, rate_card_version = $6, partial = $7
         WHERE hold_id = $1`,
        [
          hold.holdId,
          charged.toString(),
          overrun.toString(),
          quote.upstreamCostMicroUsd.toString(),
          quote.rateCardId,
          quote.rateCardVersion,
          partial,
        ],
      );
      if (charged > 0n) {
        await this.insertLedger(manager, {
          walletId: hold.walletId,
          holdId: hold.holdId,
          kind: "settle",
          amountMicro: charged,
          requestId,
          meta: {
            rateCardId: quote.rateCardId,
            rateCardVersion: quote.rateCardVersion,
            upstreamCostMicroUsd: quote.upstreamCostMicroUsd.toString(),
            usedFallback: quote.usedFallback,
          },
        });
      }
      if (overrun > 0n) {
        await this.insertLedger(manager, {
          walletId: hold.walletId,
          holdId: hold.holdId,
          kind: "overrun",
          amountMicro: overrun,
          requestId,
          meta: { partial },
        });
      }
      const grantIds = await this.chargedGrantIds(manager, hold.holdId);
      return {
        requestId,
        walletId: hold.walletId,
        chargedMicro: charged,
        overrunMicro: overrun,
        upstreamCostMicroUsd: quote.upstreamCostMicroUsd,
        rateCardId: quote.rateCardId,
        rateCardVersion: quote.rateCardVersion,
        grantIds,
        partial,
        idempotent: false,
      };
    });
  }

  async release(requestId: string, opts?: { expired?: boolean }): Promise<ReleaseResult> {
    const key = requestId.trim();
    if (!key) throw new AiPlatformException("VALIDATION_ERROR", 400, "requestId is required");
    return this.dataSource.transaction(async (manager) => {
      const walletId = await this.walletIdForRequest(manager, key, null);
      await this.lockWallet(manager, walletId);
      const hold = await this.lockHold(manager, key);
      if (!hold) throw new AiPlatformException("VALIDATION_ERROR", 400, "unknown requestId");
      if (hold.status === "settled") {
        return {
          requestId: key,
          status: hold.status,
          releasedMicro: 0n,
          idempotent: true,
          transitioned: false,
        };
      }
      if (hold.status === "released" || hold.status === "expired") {
        return {
          requestId: key,
          status: hold.status,
          releasedMicro: hold.amountMicro,
          idempotent: true,
          transitioned: false,
        };
      }
      const status = opts?.expired ? "expired" : "released";
      const kind = opts?.expired ? "expire" : "release";
      await this.restoreAmount(manager, hold.holdId, hold.amountMicro, {
        walletId: hold.walletId,
        requestId: key,
        kind,
        meta: opts?.expired ? { reason: "hold_timeout" } : { reason: "cancel" },
      });
      await manager.query(`UPDATE credit_holds SET status = $2 WHERE hold_id = $1`, [hold.holdId, status]);
      return {
        requestId: key,
        status,
        releasedMicro: hold.amountMicro,
        idempotent: false,
        transitioned: true,
      };
    });
  }

  async releaseExpiredHolds(now = new Date()): Promise<{ released: number }> {
    const rows = (await this.dataSource.query(
      `SELECT request_id FROM credit_holds
       WHERE status = 'pending' AND expires_at <= $1
       ORDER BY wallet_id, request_id`,
      [now],
    )) as Array<{ request_id: string }>;
    let released = 0;
    for (const row of rows) {
      const result = await this.release(row.request_id, { expired: true });
      if (result.transitioned) released += 1;
    }
    return { released };
  }

  /**
   * Recovers spendable remaining only. Pending holds on this grant are left
   * alone so an in-flight call can still finish. When that hold is later
   * settled, released, or expired, the unused portion is clawed back onto
   * revoked_micro and does not return to spendable remaining.
   */
  async revokeBySource(sourceType: GrantSourceType, sourceId: string, amountMicro?: bigint): Promise<RevokeResult> {
    if (!sourceId.trim()) throw new AiPlatformException("VALIDATION_ERROR", 400, "sourceId is required");
    if (amountMicro !== undefined && amountMicro < 0n) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "amountMicro must be >= 0");
    }
    return this.dataSource.transaction(async (manager) => {
      const found = (await manager.query(
        `SELECT wallet_id FROM credit_grants WHERE source_type = $1 AND source_id = $2`,
        [sourceType, sourceId],
      )) as Array<{ wallet_id: string }>;
      if (!found[0]) throw new AiPlatformException("VALIDATION_ERROR", 400, "unknown orderId");
      await this.lockWallet(manager, found[0].wallet_id);
      const grants = await this.loadGrants(manager, found[0].wallet_id);
      const grant = grants.find((row) => row.sourceType === sourceType && row.sourceId === sourceId);
      if (!grant) throw new AiPlatformException("VALIDATION_ERROR", 400, "unknown orderId");
      if (grant.revokedAt) {
        return {
          grantId: grant.grantId,
          walletId: grant.walletId,
          recoveredMicro: grant.revokedMicro,
          shortfallMicro: grant.revokeShortfallMicro,
          remainingMicro: grant.remainingMicro,
          idempotent: true,
        };
      }
      const requested = amountMicro ?? grant.amountMicro;
      const recovered = grant.remainingMicro < requested ? grant.remainingMicro : requested;
      const shortfall = requested - recovered;
      if (recovered > 0n) {
        const updated = (await manager.query(
          `UPDATE credit_grants
           SET remaining_micro = remaining_micro - $2
           WHERE grant_id = $1 AND remaining_micro >= $2
           RETURNING remaining_micro`,
          [grant.grantId, recovered.toString()],
        )) as Array<{ remaining_micro: string }>;
        if (!updated[0]) throw new AiPlatformException("VALIDATION_ERROR", 409, "grant remaining changed");
      }
      await manager.query(
        `UPDATE credit_grants
         SET revoked_micro = $2, revoke_shortfall_micro = $3, revoked_at = now()
         WHERE grant_id = $1`,
        [grant.grantId, recovered.toString(), shortfall.toString()],
      );
      if (recovered > 0n) {
        await this.insertLedger(manager, {
          walletId: grant.walletId,
          grantId: grant.grantId,
          kind: "refund_reversal",
          amountMicro: recovered,
          requestId: sourceId,
          meta: { sourceType, sourceId, shortfallMicro: shortfall.toString() },
        });
      }
      return {
        grantId: grant.grantId,
        walletId: grant.walletId,
        recoveredMicro: recovered,
        shortfallMicro: shortfall,
        remainingMicro: grant.remainingMicro - recovered,
        idempotent: false,
      };
    });
  }

  async publishRateCard(input: {
    id: string;
    version: number;
    effectiveFrom: Date;
    lines: RateLine[];
  }): Promise<{ id: string; version: number }> {
    if (!input.id.trim() || !Number.isInteger(input.version) || input.version <= 0) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "rate card id and version are required");
    }
    if (input.lines.length === 0) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "rate card lines are required");
    }
    for (const line of input.lines) {
      if (!isRateUnit(line.unit)) throw new AiPlatformException("VALIDATION_ERROR", 400, "rate card unit is invalid");
    }
    await this.dataSource.transaction(async (manager) => {
      const maxRows = (await manager.query(
        `SELECT COALESCE(MAX(version), 0) AS version FROM rate_cards WHERE rate_card_id = $1`,
        [input.id],
      )) as Array<{ version: number | string }>;
      const maxVersion = Number(maxRows[0]?.version ?? 0);
      if (input.version <= maxVersion) {
        throw new AiPlatformException("VALIDATION_ERROR", 409, "rate card version must increase");
      }
      await manager.query(
        `INSERT INTO rate_cards (rate_card_id, version, effective_from) VALUES ($1,$2,$3)`,
        [input.id, input.version, input.effectiveFrom],
      );
      for (const line of input.lines) {
        await manager.query(
          `INSERT INTO rate_card_lines (
             line_id, rate_card_id, version, capability, provider_type, model, unit,
             upstream_cost_micro_usd, markup_bps, fixed_fee_micro
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id("rcl"),
            input.id,
            input.version,
            line.capability,
            line.providerType,
            line.model,
            line.unit,
            line.upstreamCostMicroUsd.toString(),
            line.markupBps,
            line.fixedFeeMicro.toString(),
          ],
        );
      }
    });
    return { id: input.id, version: input.version };
  }

  async quote(input: {
    capability: string;
    providerType: string;
    model: string;
    usage: UsageQuantities;
    at?: Date;
  }): Promise<{ chargedMicro: bigint; upstreamCostMicroUsd: bigint; rateCardId: string; rateCardVersion: number }> {
    const card = await this.loadEffectiveCard(this.dataSource.manager, input.at ?? new Date());
    try {
      return priceUsage(card, input.capability, input.providerType, input.model, input.usage);
    } catch (error) {
      throw new AiPlatformException(
        "VALIDATION_ERROR",
        400,
        error instanceof Error ? error.message : "rate card lookup failed",
      );
    }
  }

  async listGrants(walletId: string): Promise<GrantRow[]> {
    return this.loadGrants(this.dataSource.manager, walletId);
  }

  async reconciliation(walletId: string): Promise<Reconciliation> {
    const rows = (await this.dataSource.query(
      `SELECT
         (SELECT COALESCE(SUM(amount_micro), 0) FROM credit_grants WHERE wallet_id = $1) AS granted,
         (SELECT COALESCE(SUM(remaining_micro), 0) FROM credit_grants WHERE wallet_id = $1) AS remaining,
         (SELECT COALESCE(SUM(amount_micro), 0) FROM credit_holds WHERE wallet_id = $1 AND status = 'pending') AS holds,
         (SELECT COALESCE(SUM(settled_micro), 0) FROM credit_holds WHERE wallet_id = $1 AND status = 'settled') AS settled,
         (SELECT COALESCE(SUM(revoked_micro), 0) FROM credit_grants WHERE wallet_id = $1) AS revoked`,
      [walletId],
    )) as Array<Record<string, string>>;
    const row = rows[0] ?? {};
    return {
      grantedMicro: BigInt(row.granted ?? 0),
      remainingMicro: BigInt(row.remaining ?? 0),
      activeHoldMicro: BigInt(row.holds ?? 0),
      settledMicro: BigInt(row.settled ?? 0),
      revokedMicro: BigInt(row.revoked ?? 0),
    };
  }

  private async replayGrant(input: GrantCreditsInput): Promise<GrantResult> {
    const rows = (await this.dataSource.query(
      `SELECT g.grant_id, g.wallet_id, g.kind, g.amount_micro, g.remaining_micro, w.owner_kind, w.owner_id
       FROM credit_grants g JOIN wallets w ON w.wallet_id = g.wallet_id
       WHERE g.source_type = $1 AND g.source_id = $2`,
      [input.sourceType, input.sourceId],
    )) as Array<Record<string, string>>;
    const row = rows[0];
    if (!row) throw new AiPlatformException("IDEMPOTENCY_CONFLICT", 409, "grant source conflict");
    const same =
      row.kind === input.kind &&
      BigInt(row.amount_micro) === input.amountMicro &&
      row.owner_kind === input.ownerKind &&
      row.owner_id === input.ownerId;
    if (!same) throw new AiPlatformException("IDEMPOTENCY_CONFLICT", 409, "grant source conflict");
    return {
      grantId: row.grant_id,
      walletId: row.wallet_id,
      amountMicro: BigInt(row.amount_micro),
      remainingMicro: BigInt(row.remaining_micro),
      created: false,
    };
  }

  private replayReserve(existing: HoldRow, input: ReserveInput): ReserveResult {
    const productCode = input.productCode.trim();
    const capability = input.capability.trim();
    if (
      existing.walletId !== input.walletId ||
      existing.amountMicro !== input.estimateMicro ||
      existing.productCode !== productCode ||
      existing.capability !== capability
    ) {
      throw new AiPlatformException("IDEMPOTENCY_CONFLICT", 409, "requestId was already used");
    }
    return {
      requestId: existing.requestId,
      holdId: existing.holdId,
      walletId: existing.walletId,
      amountMicro: existing.amountMicro,
      status: existing.status,
      created: false,
    };
  }

  private async settlementFromHold(manager: EntityManager, hold: HoldRow, idempotent: boolean): Promise<Settlement> {
    return {
      requestId: hold.requestId,
      walletId: hold.walletId,
      chargedMicro: hold.settledMicro ?? 0n,
      overrunMicro: hold.overrunMicro ?? 0n,
      upstreamCostMicroUsd: hold.upstreamCostMicroUsd ?? 0n,
      rateCardId: hold.rateCardId ?? "",
      rateCardVersion: hold.rateCardVersion ?? 0,
      grantIds: await this.chargedGrantIds(manager, hold.holdId),
      partial: hold.partial === true,
      idempotent,
    };
  }

  private async ensureWalletTx(
    manager: EntityManager,
    ownerKind: OwnerKind,
    ownerId: string,
    currency: WalletCurrency,
  ): Promise<WalletRecord> {
    const walletId = id("wal");
    await manager.query(
      `INSERT INTO wallets (wallet_id, owner_kind, owner_id, currency, status)
       VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (owner_kind, owner_id) DO NOTHING`,
      [walletId, ownerKind, ownerId, currency],
    );
    const rows = (await manager.query(
      `SELECT wallet_id, owner_kind, owner_id, currency, status
       FROM wallets WHERE owner_kind = $1 AND owner_id = $2 FOR UPDATE`,
      [ownerKind, ownerId],
    )) as Array<Record<string, string>>;
    const row = rows[0];
    if (!row) throw new AiPlatformException("VALIDATION_ERROR", 500, "wallet insert failed");
    if (row.currency !== currency) {
      throw new AiPlatformException("VALIDATION_ERROR", 409, "wallet currency is immutable");
    }
    return {
      walletId: row.wallet_id,
      ownerKind: row.owner_kind as OwnerKind,
      ownerId: row.owner_id,
      currency: row.currency as WalletCurrency,
      status: row.status as WalletRecord["status"],
    };
  }

  private async walletIdForRequest(
    manager: EntityManager,
    requestId: string,
    fallback: string | null,
  ): Promise<string> {
    const rows = (await manager.query(`SELECT wallet_id FROM credit_holds WHERE request_id = $1`, [
      requestId,
    ])) as Array<{ wallet_id: string }>;
    const walletId = rows[0]?.wallet_id ?? fallback;
    if (!walletId) throw new AiPlatformException("VALIDATION_ERROR", 400, "unknown requestId");
    return walletId;
  }

  private async lockWallet(manager: EntityManager, walletId: string): Promise<WalletRecord> {
    const rows = (await manager.query(
      `SELECT wallet_id, owner_kind, owner_id, currency, status FROM wallets WHERE wallet_id = $1 FOR UPDATE`,
      [walletId],
    )) as Array<Record<string, string>>;
    const row = rows[0];
    if (!row) throw new AiPlatformException("VALIDATION_ERROR", 400, "wallet not found");
    return {
      walletId: row.wallet_id,
      ownerKind: row.owner_kind as OwnerKind,
      ownerId: row.owner_id,
      currency: row.currency as WalletCurrency,
      status: row.status as WalletRecord["status"],
    };
  }

  private async lockHold(manager: EntityManager, requestId: string): Promise<HoldRow | null> {
    const rows = (await manager.query(`SELECT * FROM credit_holds WHERE request_id = $1 FOR UPDATE`, [
      requestId,
    ])) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    return {
      holdId: String(row.hold_id),
      walletId: String(row.wallet_id),
      requestId: String(row.request_id),
      amountMicro: BigInt(String(row.amount_micro)),
      status: String(row.status) as HoldRow["status"],
      productCode: row.product_code == null ? null : String(row.product_code),
      capability: row.capability == null ? null : String(row.capability),
      settledMicro: row.settled_micro == null ? null : BigInt(String(row.settled_micro)),
      overrunMicro: row.overrun_micro == null ? null : BigInt(String(row.overrun_micro)),
      upstreamCostMicroUsd:
        row.upstream_cost_micro_usd == null ? null : BigInt(String(row.upstream_cost_micro_usd)),
      rateCardId: row.rate_card_id == null ? null : String(row.rate_card_id),
      rateCardVersion: row.rate_card_version == null ? null : Number(row.rate_card_version),
      partial: row.partial == null ? null : Boolean(row.partial),
    };
  }

  private async loadGrants(manager: EntityManager, walletId: string): Promise<GrantRow[]> {
    const rows = (await manager.query(
      `SELECT * FROM credit_grants WHERE wallet_id = $1 ORDER BY grant_id FOR UPDATE`,
      [walletId],
    )) as Array<Record<string, unknown>>;
    return rows.map(mapGrant);
  }

  private async planDraw(
    manager: EntityManager,
    walletId: string,
    ctx: SpendContext,
    needed: bigint,
    partial: boolean,
  ): Promise<{ takes: Array<{ grant: GrantRow; take: bigint }>; drawn: bigint }> {
    const grants = await this.loadGrants(manager, walletId);
    const ordered = (grantsForSpend(grants, ctx) as GrantRow[]).filter((grant) => grant.revokedAt == null);
    const takes: Array<{ grant: GrantRow; take: bigint }> = [];
    let left = needed;
    for (const grant of ordered) {
      if (left <= 0n) break;
      const take = grant.remainingMicro < left ? grant.remainingMicro : left;
      if (take <= 0n) continue;
      takes.push({ grant, take });
      left -= take;
    }
    const drawn = needed - left;
    if (!partial && drawn !== needed) {
      throw new AiPlatformException("INSUFFICIENT_CREDITS", 402, "Insufficient credits");
    }
    return { takes, drawn };
  }

  private async applyDraw(
    manager: EntityManager,
    input: {
      walletId: string;
      holdId: string;
      requestId: string;
      plan: { takes: Array<{ grant: GrantRow; take: bigint }>; drawn: bigint };
      ledgerKind: "reserve";
    },
  ): Promise<void> {
    const ordinalRows = (await manager.query(
      `SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM credit_hold_allocations WHERE hold_id = $1`,
      [input.holdId],
    )) as Array<{ ordinal: number | string }>;
    let ordinal = Number(ordinalRows[0]?.ordinal ?? 0);
    for (const take of input.plan.takes) {
      ordinal += 1;
      const updated = (await manager.query(
        `UPDATE credit_grants
         SET remaining_micro = remaining_micro - $2
         WHERE grant_id = $1 AND remaining_micro >= $2
         RETURNING remaining_micro`,
        [take.grant.grantId, take.take.toString()],
      )) as Array<{ remaining_micro: string }>;
      if (!updated[0]) throw new AiPlatformException("INSUFFICIENT_CREDITS", 402, "Insufficient credits");
      await manager.query(
        `INSERT INTO credit_hold_allocations (
           allocation_id, hold_id, grant_id, ordinal, amount_micro, released_micro
         ) VALUES ($1,$2,$3,$4,$5,0)`,
        [id("alloc"), input.holdId, take.grant.grantId, ordinal, take.take.toString()],
      );
      await this.insertLedger(manager, {
        walletId: input.walletId,
        grantId: take.grant.grantId,
        holdId: input.holdId,
        kind: input.ledgerKind,
        amountMicro: take.take,
        requestId: input.requestId,
        meta: { ordinal },
      });
    }
  }

  /**
   * Returns unused hold amount to the grants it came from.
   * A grant with revoked_at does not become spendable again: the return is
   * added to revoked_micro and reduces revoke_shortfall_micro instead.
   */
  private async restoreAmount(
    manager: EntityManager,
    holdId: string,
    amount: bigint,
    audit: { walletId: string; requestId: string; kind: "release" | "expire"; meta?: Record<string, unknown> },
  ): Promise<void> {
    if (amount <= 0n) return;
    const rows = (await manager.query(
      `SELECT allocation_id, grant_id, amount_micro, released_micro
       FROM credit_hold_allocations
       WHERE hold_id = $1
       ORDER BY ordinal DESC
       FOR UPDATE`,
      [holdId],
    )) as Array<Record<string, string | number>>;
    const grantIds = [...new Set(rows.map((row) => String(row.grant_id)))].sort();
    const grantState = new Map<string, { revoked: boolean; shortfall: bigint }>();
    if (grantIds.length > 0) {
      const locked = (await manager.query(
        `SELECT grant_id, revoked_at, revoke_shortfall_micro
         FROM credit_grants
         WHERE grant_id = ANY($1::varchar[])
         ORDER BY grant_id
         FOR UPDATE`,
        [grantIds],
      )) as Array<{ grant_id: string; revoked_at: Date | null; revoke_shortfall_micro: string }>;
      for (const grant of locked) {
        grantState.set(grant.grant_id, {
          revoked: grant.revoked_at != null,
          shortfall: BigInt(grant.revoke_shortfall_micro ?? 0),
        });
      }
    }
    let left = amount;
    for (const row of rows) {
      if (left <= 0n) break;
      const held = BigInt(row.amount_micro) - BigInt(row.released_micro);
      if (held <= 0n) continue;
      const give = held < left ? held : left;
      const grantId = String(row.grant_id);
      const state = grantState.get(grantId);
      if (!state) throw new AiPlatformException("VALIDATION_ERROR", 500, "grant missing during release");
      if (state.revoked) {
        const nextShortfall = state.shortfall > give ? state.shortfall - give : 0n;
        const clawed = (await manager.query(
          `UPDATE credit_grants
           SET revoked_micro = revoked_micro + $2,
               revoke_shortfall_micro = $3
           WHERE grant_id = $1 AND revoked_at IS NOT NULL
           RETURNING revoked_micro, remaining_micro`,
          [grantId, give.toString(), nextShortfall.toString()],
        )) as Array<{ revoked_micro: string; remaining_micro: string }>;
        if (!clawed[0]) throw new AiPlatformException("VALIDATION_ERROR", 500, "revoked grant missing during release");
        state.shortfall = nextShortfall;
        await this.insertLedger(manager, {
          walletId: audit.walletId,
          grantId,
          holdId,
          kind: "refund_reversal",
          amountMicro: give,
          requestId: audit.requestId,
          meta: { ...(audit.meta ?? {}), fromHoldRelease: true },
        });
      } else {
        const updated = (await manager.query(
          `UPDATE credit_grants SET remaining_micro = remaining_micro + $2
           WHERE grant_id = $1 AND revoked_at IS NULL
           RETURNING remaining_micro`,
          [grantId, give.toString()],
        )) as Array<{ remaining_micro: string }>;
        if (!updated[0]) throw new AiPlatformException("VALIDATION_ERROR", 500, "grant missing during release");
        await this.insertLedger(manager, {
          walletId: audit.walletId,
          grantId,
          holdId,
          kind: audit.kind,
          amountMicro: give,
          requestId: audit.requestId,
          meta: audit.meta ?? {},
        });
      }
      await manager.query(
        `UPDATE credit_hold_allocations SET released_micro = released_micro + $2 WHERE allocation_id = $1`,
        [row.allocation_id, give.toString()],
      );
      left -= give;
    }
    if (left !== 0n) throw new AiPlatformException("VALIDATION_ERROR", 500, "hold allocation could not be restored");
  }

  private async chargedGrantIds(manager: EntityManager, holdId: string): Promise<string[]> {
    const rows = (await manager.query(
      `SELECT grant_id FROM credit_hold_allocations
       WHERE hold_id = $1 AND amount_micro > released_micro
       ORDER BY ordinal`,
      [holdId],
    )) as Array<{ grant_id: string }>;
    return rows.map((row) => row.grant_id);
  }

  private async loadEffectiveCard(manager: EntityManager, at: Date): Promise<CardSnapshot> {
    const headers = (await manager.query(
      `SELECT rate_card_id, version FROM rate_cards
       WHERE effective_from <= $1
       ORDER BY effective_from DESC, version DESC
       LIMIT 1`,
      [at],
    )) as Array<{ rate_card_id: string; version: number | string }>;
    const header = headers[0];
    if (!header) throw new AiPlatformException("VALIDATION_ERROR", 400, "no effective rate card");
    const version = Number(header.version);
    const lines = (await manager.query(
      `SELECT capability, provider_type, model, unit, upstream_cost_micro_usd, markup_bps, fixed_fee_micro
       FROM rate_card_lines WHERE rate_card_id = $1 AND version = $2`,
      [header.rate_card_id, version],
    )) as Array<Record<string, string | number>>;
    return {
      id: header.rate_card_id,
      version,
      lines: lines.map((line) => ({
        capability: String(line.capability),
        providerType: String(line.provider_type),
        model: String(line.model),
        unit: String(line.unit) as RateLine["unit"],
        upstreamCostMicroUsd: BigInt(line.upstream_cost_micro_usd),
        markupBps: Number(line.markup_bps),
        fixedFeeMicro: BigInt(line.fixed_fee_micro),
      })),
    };
  }

  /** Insert-only. There is no update or delete path for ledger_entries. */
  private async insertLedger(
    manager: EntityManager,
    input: {
      walletId: string;
      grantId?: string | null;
      holdId?: string | null;
      kind: string;
      amountMicro: bigint;
      requestId?: string | null;
      meta?: Record<string, unknown>;
    },
  ): Promise<void> {
    const balance = await this.remainingSum(manager, input.walletId);
    await manager.query(
      `INSERT INTO ledger_entries (
         entry_id, wallet_id, grant_id, hold_id, kind, amount_micro, balance_after_micro, request_id, meta
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        id("led"),
        input.walletId,
        input.grantId ?? null,
        input.holdId ?? null,
        input.kind,
        input.amountMicro.toString(),
        balance.toString(),
        input.requestId ?? null,
        JSON.stringify(input.meta ?? {}),
      ],
    );
  }

  private async remainingSum(manager: EntityManager, walletId: string): Promise<bigint> {
    const rows = (await manager.query(
      `SELECT COALESCE(SUM(remaining_micro), 0) AS remaining FROM credit_grants WHERE wallet_id = $1`,
      [walletId],
    )) as Array<{ remaining: string }>;
    return BigInt(rows[0]?.remaining ?? 0);
  }

  private assertGrant(input: GrantCreditsInput): void {
    if (!input.sourceId.trim()) throw new AiPlatformException("VALIDATION_ERROR", 400, "sourceId is required");
    if (input.amountMicro <= 0n) throw new AiPlatformException("VALIDATION_ERROR", 400, "amountMicro must be positive");
    if (
      (input.kind === "subscription" || input.kind === "promo" || input.kind === "trial") &&
      !input.expiresAt
    ) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "expiresAt is required for this grant kind");
    }
  }
}

export function amountsToJson<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === "bigint" ? microToNumber(value) : value;
  }
  return out;
}

function mapGrant(row: Record<string, unknown>): GrantRow {
  return {
    grantId: String(row.grant_id),
    walletId: String(row.wallet_id),
    kind: String(row.kind),
    amountMicro: BigInt(String(row.amount_micro)),
    remainingMicro: BigInt(String(row.remaining_micro)),
    expiresAt: asDate(row.expires_at),
    createdAt: asDate(row.created_at) ?? new Date(),
    restrictProductCodes: asStringList(row.restrict_product_codes),
    restrictCapabilities: asStringList(row.restrict_capabilities),
    sourceType: String(row.source_type),
    sourceId: String(row.source_id),
    revokedMicro: BigInt(String(row.revoked_micro ?? 0)),
    revokeShortfallMicro: BigInt(String(row.revoke_shortfall_micro ?? 0)),
    revokedAt: asDate(row.revoked_at),
  };
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asStringList(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  return null;
}

function jsonOrNull(value: string[] | null | undefined): string | null {
  if (!value || value.length === 0) return null;
  return JSON.stringify(value);
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`.slice(0, 64);
}
