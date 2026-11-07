"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletService = exports.HOLD_TTL_MS = void 0;
exports.amountsToJson = amountsToJson;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const errors_1 = require("../common/errors");
const money_1 = require("./money");
const rate_card_1 = require("./rate-card");
const spend_order_1 = require("./spend-order");
exports.HOLD_TTL_MS = 15 * 60 * 1000;
const OVERRUN_PARTIAL_BPS = 2000n;
/**
 * Credit ledger. Lock order is always wallet, then grants by grant_id, then the hold.
 * ledger_entries is insert-only; the database trigger rejects UPDATE and DELETE.
 */
let WalletService = class WalletService {
    dataSource;
    constructor(dataSource) {
        this.dataSource = dataSource;
    }
    async ensureWallet(ownerKind, ownerId, currency = "USD") {
        if (ownerKind !== "user" && ownerKind !== "organization") {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "ownerKind is invalid");
        }
        if (!ownerId.trim())
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "ownerId is required");
        if (currency !== "USD" && currency !== "CNY") {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "currency is invalid");
        }
        return this.dataSource.transaction(async (manager) => this.ensureWalletTx(manager, ownerKind, ownerId, currency));
    }
    async grantCredits(input) {
        this.assertGrant(input);
        try {
            return await this.dataSource.transaction(async (manager) => {
                const wallet = await this.ensureWalletTx(manager, input.ownerKind, input.ownerId, input.currency ?? "USD");
                const grantId = id("gr");
                await manager.query(`INSERT INTO credit_grants (
             grant_id, wallet_id, kind, amount_micro, remaining_micro, expires_at,
             restrict_product_codes, restrict_capabilities, source_type, source_id
           ) VALUES ($1,$2,$3,$4,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`, [
                    grantId,
                    wallet.walletId,
                    input.kind,
                    input.amountMicro.toString(),
                    input.expiresAt ?? null,
                    jsonOrNull(input.restrictProductCodes),
                    jsonOrNull(input.restrictCapabilities),
                    input.sourceType,
                    input.sourceId,
                ]);
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
        }
        catch (error) {
            if (!(0, money_1.isUniqueViolation)(error))
                throw error;
            return this.replayGrant(input);
        }
    }
    async reserve(input) {
        const requestId = input.requestId.trim();
        if (!requestId)
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "requestId is required");
        if (input.estimateMicro < 0n) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "estimateMicro must be >= 0");
        }
        const productCode = input.productCode.trim();
        const capability = input.capability.trim();
        if (!productCode || !capability) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "productCode and capability are required");
        }
        return this.dataSource.transaction(async (manager) => {
            const walletId = await this.walletIdForRequest(manager, requestId, input.walletId);
            const wallet = await this.lockWallet(manager, walletId);
            const existing = await this.lockHold(manager, requestId);
            if (existing)
                return this.replayReserve(existing, input);
            if (wallet.status !== "active") {
                throw new errors_1.AiPlatformException("FORBIDDEN", 403, "wallet is not active");
            }
            const now = new Date();
            const ctx = { productCode, capability, now };
            const plan = await this.planDraw(manager, wallet.walletId, ctx, input.estimateMicro, false);
            const holdId = id("hold");
            const expiresAt = new Date(now.getTime() + (input.ttlMs ?? exports.HOLD_TTL_MS));
            await manager.query(`INSERT INTO credit_holds (
           hold_id, wallet_id, request_id, amount_micro, status, expires_at, product_code, capability
         ) VALUES ($1,$2,$3,$4,'pending',$5,$6,$7)`, [holdId, wallet.walletId, requestId, input.estimateMicro.toString(), expiresAt, productCode, capability]);
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
    async settle(input) {
        const requestId = input.requestId.trim();
        if (!requestId)
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "requestId is required");
        return this.dataSource.transaction(async (manager) => {
            const walletId = await this.walletIdForRequest(manager, requestId, null);
            await this.lockWallet(manager, walletId);
            const hold = await this.lockHold(manager, requestId);
            if (!hold)
                throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "unknown requestId");
            if (hold.status === "settled")
                return this.settlementFromHold(manager, hold, true);
            if (hold.status !== "pending") {
                throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "hold is not pending");
            }
            const capability = input.capability.trim() || hold.capability || "";
            const productCode = hold.productCode || "";
            const card = await this.loadEffectiveCard(manager, new Date());
            let quote;
            try {
                quote = (0, rate_card_1.priceUsage)(card, capability, input.providerType, input.model, input.usage);
            }
            catch (error) {
                throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, error instanceof Error ? error.message : "rate card lookup failed");
            }
            if (quote.usedFallback) {
                console.warn(`ai-platform rate card fallback ${card.id}@${card.version} ${capability}/${input.providerType}/${input.model}`);
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
            }
            else {
                const extra = actual - hold.amountMicro;
                const now = new Date();
                const plan = await this.planDraw(manager, hold.walletId, { productCode, capability, now }, extra, true);
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
            const partial = overrun * 10000n > hold.amountMicro * OVERRUN_PARTIAL_BPS;
            await manager.query(`UPDATE credit_holds
         SET status = 'settled', settled_micro = $2, overrun_micro = $3,
             upstream_cost_micro_usd = $4, rate_card_id = $5, rate_card_version = $6, partial = $7
         WHERE hold_id = $1`, [
                hold.holdId,
                charged.toString(),
                overrun.toString(),
                quote.upstreamCostMicroUsd.toString(),
                quote.rateCardId,
                quote.rateCardVersion,
                partial,
            ]);
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
    async release(requestId, opts) {
        const key = requestId.trim();
        if (!key)
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "requestId is required");
        return this.dataSource.transaction(async (manager) => {
            const walletId = await this.walletIdForRequest(manager, key, null);
            await this.lockWallet(manager, walletId);
            const hold = await this.lockHold(manager, key);
            if (!hold)
                throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "unknown requestId");
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
    async releaseExpiredHolds(now = new Date()) {
        const rows = (await this.dataSource.query(`SELECT request_id FROM credit_holds
       WHERE status = 'pending' AND expires_at <= $1
       ORDER BY wallet_id, request_id`, [now]));
        let released = 0;
        for (const row of rows) {
            const result = await this.release(row.request_id, { expired: true });
            if (result.transitioned)
                released += 1;
        }
        return { released };
    }
    /**
     * Recovers spendable remaining only. Pending holds on this grant are left
     * alone so an in-flight call can still finish. When that hold is later
     * settled, released, or expired, the unused portion is clawed back onto
     * revoked_micro and does not return to spendable remaining.
     */
    async revokeBySource(sourceType, sourceId, amountMicro) {
        if (!sourceId.trim())
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "sourceId is required");
        if (amountMicro !== undefined && amountMicro < 0n) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "amountMicro must be >= 0");
        }
        return this.dataSource.transaction(async (manager) => {
            const found = (await manager.query(`SELECT wallet_id FROM credit_grants WHERE source_type = $1 AND source_id = $2`, [sourceType, sourceId]));
            if (!found[0])
                throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "unknown orderId");
            await this.lockWallet(manager, found[0].wallet_id);
            const grants = await this.loadGrants(manager, found[0].wallet_id);
            const grant = grants.find((row) => row.sourceType === sourceType && row.sourceId === sourceId);
            if (!grant)
                throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "unknown orderId");
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
                const updated = (await manager.query(`UPDATE credit_grants
           SET remaining_micro = remaining_micro - $2
           WHERE grant_id = $1 AND remaining_micro >= $2
           RETURNING remaining_micro`, [grant.grantId, recovered.toString()]));
                if (!updated[0])
                    throw new errors_1.AiPlatformException("VALIDATION_ERROR", 409, "grant remaining changed");
            }
            await manager.query(`UPDATE credit_grants
         SET revoked_micro = $2, revoke_shortfall_micro = $3, revoked_at = now()
         WHERE grant_id = $1`, [grant.grantId, recovered.toString(), shortfall.toString()]);
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
    async publishRateCard(input) {
        if (!input.id.trim() || !Number.isInteger(input.version) || input.version <= 0) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "rate card id and version are required");
        }
        if (input.lines.length === 0) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "rate card lines are required");
        }
        for (const line of input.lines) {
            if (!(0, rate_card_1.isRateUnit)(line.unit))
                throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "rate card unit is invalid");
        }
        await this.dataSource.transaction(async (manager) => {
            const maxRows = (await manager.query(`SELECT COALESCE(MAX(version), 0) AS version FROM rate_cards WHERE rate_card_id = $1`, [input.id]));
            const maxVersion = Number(maxRows[0]?.version ?? 0);
            if (input.version <= maxVersion) {
                throw new errors_1.AiPlatformException("VALIDATION_ERROR", 409, "rate card version must increase");
            }
            await manager.query(`INSERT INTO rate_cards (rate_card_id, version, effective_from) VALUES ($1,$2,$3)`, [input.id, input.version, input.effectiveFrom]);
            for (const line of input.lines) {
                await manager.query(`INSERT INTO rate_card_lines (
             line_id, rate_card_id, version, capability, provider_type, model, unit,
             upstream_cost_micro_usd, markup_bps, fixed_fee_micro
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
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
                ]);
            }
        });
        return { id: input.id, version: input.version };
    }
    async quote(input) {
        const card = await this.loadEffectiveCard(this.dataSource.manager, input.at ?? new Date());
        try {
            return (0, rate_card_1.priceUsage)(card, input.capability, input.providerType, input.model, input.usage);
        }
        catch (error) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, error instanceof Error ? error.message : "rate card lookup failed");
        }
    }
    async listGrants(walletId) {
        return this.loadGrants(this.dataSource.manager, walletId);
    }
    async reconciliation(walletId) {
        const rows = (await this.dataSource.query(`SELECT
         (SELECT COALESCE(SUM(amount_micro), 0) FROM credit_grants WHERE wallet_id = $1) AS granted,
         (SELECT COALESCE(SUM(remaining_micro), 0) FROM credit_grants WHERE wallet_id = $1) AS remaining,
         (SELECT COALESCE(SUM(amount_micro), 0) FROM credit_holds WHERE wallet_id = $1 AND status = 'pending') AS holds,
         (SELECT COALESCE(SUM(settled_micro), 0) FROM credit_holds WHERE wallet_id = $1 AND status = 'settled') AS settled,
         (SELECT COALESCE(SUM(revoked_micro), 0) FROM credit_grants WHERE wallet_id = $1) AS revoked`, [walletId]));
        const row = rows[0] ?? {};
        return {
            grantedMicro: BigInt(row.granted ?? 0),
            remainingMicro: BigInt(row.remaining ?? 0),
            activeHoldMicro: BigInt(row.holds ?? 0),
            settledMicro: BigInt(row.settled ?? 0),
            revokedMicro: BigInt(row.revoked ?? 0),
        };
    }
    async replayGrant(input) {
        const rows = (await this.dataSource.query(`SELECT g.grant_id, g.wallet_id, g.kind, g.amount_micro, g.remaining_micro, w.owner_kind, w.owner_id
       FROM credit_grants g JOIN wallets w ON w.wallet_id = g.wallet_id
       WHERE g.source_type = $1 AND g.source_id = $2`, [input.sourceType, input.sourceId]));
        const row = rows[0];
        if (!row)
            throw new errors_1.AiPlatformException("IDEMPOTENCY_CONFLICT", 409, "grant source conflict");
        const same = row.kind === input.kind &&
            BigInt(row.amount_micro) === input.amountMicro &&
            row.owner_kind === input.ownerKind &&
            row.owner_id === input.ownerId;
        if (!same)
            throw new errors_1.AiPlatformException("IDEMPOTENCY_CONFLICT", 409, "grant source conflict");
        return {
            grantId: row.grant_id,
            walletId: row.wallet_id,
            amountMicro: BigInt(row.amount_micro),
            remainingMicro: BigInt(row.remaining_micro),
            created: false,
        };
    }
    replayReserve(existing, input) {
        const productCode = input.productCode.trim();
        const capability = input.capability.trim();
        if (existing.walletId !== input.walletId ||
            existing.amountMicro !== input.estimateMicro ||
            existing.productCode !== productCode ||
            existing.capability !== capability) {
            throw new errors_1.AiPlatformException("IDEMPOTENCY_CONFLICT", 409, "requestId was already used");
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
    async settlementFromHold(manager, hold, idempotent) {
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
    async ensureWalletTx(manager, ownerKind, ownerId, currency) {
        const walletId = id("wal");
        await manager.query(`INSERT INTO wallets (wallet_id, owner_kind, owner_id, currency, status)
       VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (owner_kind, owner_id) DO NOTHING`, [walletId, ownerKind, ownerId, currency]);
        const rows = (await manager.query(`SELECT wallet_id, owner_kind, owner_id, currency, status
       FROM wallets WHERE owner_kind = $1 AND owner_id = $2 FOR UPDATE`, [ownerKind, ownerId]));
        const row = rows[0];
        if (!row)
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 500, "wallet insert failed");
        if (row.currency !== currency) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 409, "wallet currency is immutable");
        }
        return {
            walletId: row.wallet_id,
            ownerKind: row.owner_kind,
            ownerId: row.owner_id,
            currency: row.currency,
            status: row.status,
        };
    }
    async walletIdForRequest(manager, requestId, fallback) {
        const rows = (await manager.query(`SELECT wallet_id FROM credit_holds WHERE request_id = $1`, [
            requestId,
        ]));
        const walletId = rows[0]?.wallet_id ?? fallback;
        if (!walletId)
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "unknown requestId");
        return walletId;
    }
    async lockWallet(manager, walletId) {
        const rows = (await manager.query(`SELECT wallet_id, owner_kind, owner_id, currency, status FROM wallets WHERE wallet_id = $1 FOR UPDATE`, [walletId]));
        const row = rows[0];
        if (!row)
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "wallet not found");
        return {
            walletId: row.wallet_id,
            ownerKind: row.owner_kind,
            ownerId: row.owner_id,
            currency: row.currency,
            status: row.status,
        };
    }
    async lockHold(manager, requestId) {
        const rows = (await manager.query(`SELECT * FROM credit_holds WHERE request_id = $1 FOR UPDATE`, [
            requestId,
        ]));
        const row = rows[0];
        if (!row)
            return null;
        return {
            holdId: String(row.hold_id),
            walletId: String(row.wallet_id),
            requestId: String(row.request_id),
            amountMicro: BigInt(String(row.amount_micro)),
            status: String(row.status),
            productCode: row.product_code == null ? null : String(row.product_code),
            capability: row.capability == null ? null : String(row.capability),
            settledMicro: row.settled_micro == null ? null : BigInt(String(row.settled_micro)),
            overrunMicro: row.overrun_micro == null ? null : BigInt(String(row.overrun_micro)),
            upstreamCostMicroUsd: row.upstream_cost_micro_usd == null ? null : BigInt(String(row.upstream_cost_micro_usd)),
            rateCardId: row.rate_card_id == null ? null : String(row.rate_card_id),
            rateCardVersion: row.rate_card_version == null ? null : Number(row.rate_card_version),
            partial: row.partial == null ? null : Boolean(row.partial),
        };
    }
    async loadGrants(manager, walletId) {
        const rows = (await manager.query(`SELECT * FROM credit_grants WHERE wallet_id = $1 ORDER BY grant_id FOR UPDATE`, [walletId]));
        return rows.map(mapGrant);
    }
    async planDraw(manager, walletId, ctx, needed, partial) {
        const grants = await this.loadGrants(manager, walletId);
        const ordered = (0, spend_order_1.grantsForSpend)(grants, ctx).filter((grant) => grant.revokedAt == null);
        const takes = [];
        let left = needed;
        for (const grant of ordered) {
            if (left <= 0n)
                break;
            const take = grant.remainingMicro < left ? grant.remainingMicro : left;
            if (take <= 0n)
                continue;
            takes.push({ grant, take });
            left -= take;
        }
        const drawn = needed - left;
        if (!partial && drawn !== needed) {
            throw new errors_1.AiPlatformException("INSUFFICIENT_CREDITS", 402, "Insufficient credits");
        }
        return { takes, drawn };
    }
    async applyDraw(manager, input) {
        const ordinalRows = (await manager.query(`SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM credit_hold_allocations WHERE hold_id = $1`, [input.holdId]));
        let ordinal = Number(ordinalRows[0]?.ordinal ?? 0);
        for (const take of input.plan.takes) {
            ordinal += 1;
            const updated = (await manager.query(`UPDATE credit_grants
         SET remaining_micro = remaining_micro - $2
         WHERE grant_id = $1 AND remaining_micro >= $2
         RETURNING remaining_micro`, [take.grant.grantId, take.take.toString()]));
            if (!updated[0])
                throw new errors_1.AiPlatformException("INSUFFICIENT_CREDITS", 402, "Insufficient credits");
            await manager.query(`INSERT INTO credit_hold_allocations (
           allocation_id, hold_id, grant_id, ordinal, amount_micro, released_micro
         ) VALUES ($1,$2,$3,$4,$5,0)`, [id("alloc"), input.holdId, take.grant.grantId, ordinal, take.take.toString()]);
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
    async restoreAmount(manager, holdId, amount, audit) {
        if (amount <= 0n)
            return;
        const rows = (await manager.query(`SELECT allocation_id, grant_id, amount_micro, released_micro
       FROM credit_hold_allocations
       WHERE hold_id = $1
       ORDER BY ordinal DESC
       FOR UPDATE`, [holdId]));
        const grantIds = [...new Set(rows.map((row) => String(row.grant_id)))].sort();
        const grantState = new Map();
        if (grantIds.length > 0) {
            const locked = (await manager.query(`SELECT grant_id, revoked_at, revoke_shortfall_micro
         FROM credit_grants
         WHERE grant_id = ANY($1::varchar[])
         ORDER BY grant_id
         FOR UPDATE`, [grantIds]));
            for (const grant of locked) {
                grantState.set(grant.grant_id, {
                    revoked: grant.revoked_at != null,
                    shortfall: BigInt(grant.revoke_shortfall_micro ?? 0),
                });
            }
        }
        let left = amount;
        for (const row of rows) {
            if (left <= 0n)
                break;
            const held = BigInt(row.amount_micro) - BigInt(row.released_micro);
            if (held <= 0n)
                continue;
            const give = held < left ? held : left;
            const grantId = String(row.grant_id);
            const state = grantState.get(grantId);
            if (!state)
                throw new errors_1.AiPlatformException("VALIDATION_ERROR", 500, "grant missing during release");
            if (state.revoked) {
                const nextShortfall = state.shortfall > give ? state.shortfall - give : 0n;
                const clawed = (await manager.query(`UPDATE credit_grants
           SET revoked_micro = revoked_micro + $2,
               revoke_shortfall_micro = $3
           WHERE grant_id = $1 AND revoked_at IS NOT NULL
           RETURNING revoked_micro, remaining_micro`, [grantId, give.toString(), nextShortfall.toString()]));
                if (!clawed[0])
                    throw new errors_1.AiPlatformException("VALIDATION_ERROR", 500, "revoked grant missing during release");
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
            }
            else {
                const updated = (await manager.query(`UPDATE credit_grants SET remaining_micro = remaining_micro + $2
           WHERE grant_id = $1 AND revoked_at IS NULL
           RETURNING remaining_micro`, [grantId, give.toString()]));
                if (!updated[0])
                    throw new errors_1.AiPlatformException("VALIDATION_ERROR", 500, "grant missing during release");
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
            await manager.query(`UPDATE credit_hold_allocations SET released_micro = released_micro + $2 WHERE allocation_id = $1`, [row.allocation_id, give.toString()]);
            left -= give;
        }
        if (left !== 0n)
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 500, "hold allocation could not be restored");
    }
    async chargedGrantIds(manager, holdId) {
        const rows = (await manager.query(`SELECT grant_id FROM credit_hold_allocations
       WHERE hold_id = $1 AND amount_micro > released_micro
       ORDER BY ordinal`, [holdId]));
        return rows.map((row) => row.grant_id);
    }
    async loadEffectiveCard(manager, at) {
        const headers = (await manager.query(`SELECT rate_card_id, version FROM rate_cards
       WHERE effective_from <= $1
       ORDER BY effective_from DESC, version DESC
       LIMIT 1`, [at]));
        const header = headers[0];
        if (!header)
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "no effective rate card");
        const version = Number(header.version);
        const lines = (await manager.query(`SELECT capability, provider_type, model, unit, upstream_cost_micro_usd, markup_bps, fixed_fee_micro
       FROM rate_card_lines WHERE rate_card_id = $1 AND version = $2`, [header.rate_card_id, version]));
        return {
            id: header.rate_card_id,
            version,
            lines: lines.map((line) => ({
                capability: String(line.capability),
                providerType: String(line.provider_type),
                model: String(line.model),
                unit: String(line.unit),
                upstreamCostMicroUsd: BigInt(line.upstream_cost_micro_usd),
                markupBps: Number(line.markup_bps),
                fixedFeeMicro: BigInt(line.fixed_fee_micro),
            })),
        };
    }
    /** Insert-only. There is no update or delete path for ledger_entries. */
    async insertLedger(manager, input) {
        const balance = await this.remainingSum(manager, input.walletId);
        await manager.query(`INSERT INTO ledger_entries (
         entry_id, wallet_id, grant_id, hold_id, kind, amount_micro, balance_after_micro, request_id, meta
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [
            id("led"),
            input.walletId,
            input.grantId ?? null,
            input.holdId ?? null,
            input.kind,
            input.amountMicro.toString(),
            balance.toString(),
            input.requestId ?? null,
            JSON.stringify(input.meta ?? {}),
        ]);
    }
    async remainingSum(manager, walletId) {
        const rows = (await manager.query(`SELECT COALESCE(SUM(remaining_micro), 0) AS remaining FROM credit_grants WHERE wallet_id = $1`, [walletId]));
        return BigInt(rows[0]?.remaining ?? 0);
    }
    assertGrant(input) {
        if (!input.sourceId.trim())
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "sourceId is required");
        if (input.amountMicro <= 0n)
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "amountMicro must be positive");
        if ((input.kind === "subscription" || input.kind === "promo" || input.kind === "trial") &&
            !input.expiresAt) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "expiresAt is required for this grant kind");
        }
    }
};
exports.WalletService = WalletService;
exports.WalletService = WalletService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], WalletService);
function amountsToJson(row) {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        out[key] = typeof value === "bigint" ? (0, money_1.microToNumber)(value) : value;
    }
    return out;
}
function mapGrant(row) {
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
function asDate(value) {
    if (value == null)
        return null;
    if (value instanceof Date)
        return value;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function asStringList(value) {
    if (value == null)
        return null;
    if (Array.isArray(value))
        return value.map(String);
    return null;
}
function jsonOrNull(value) {
    if (!value || value.length === 0)
        return null;
    return JSON.stringify(value);
}
function id(prefix) {
    return `${prefix}_${(0, node_crypto_1.randomUUID)().replace(/-/g, "")}`.slice(0, 64);
}
