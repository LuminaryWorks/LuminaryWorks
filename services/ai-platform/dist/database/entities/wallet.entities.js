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
exports.RateCardLineEntity = exports.RateCardEntity = exports.LedgerEntryEntity = exports.CreditHoldEntity = exports.CreditGrantEntity = exports.WalletEntity = void 0;
const typeorm_1 = require("typeorm");
const micro = {
    to: (value) => (value == null ? null : value.toString()),
    from: (value) => (value == null ? null : BigInt(value)),
};
/** Schema mirror. Ledger mutations go through WalletService inserts only. */
let WalletEntity = class WalletEntity {
    walletId;
    ownerKind;
    ownerId;
    currency;
    status;
    createdAt;
};
exports.WalletEntity = WalletEntity;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ name: "wallet_id", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], WalletEntity.prototype, "walletId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "owner_kind", type: "varchar", length: 32 }),
    __metadata("design:type", String)
], WalletEntity.prototype, "ownerKind", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "owner_id", type: "varchar", length: 128 }),
    __metadata("design:type", String)
], WalletEntity.prototype, "ownerId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 8 }),
    __metadata("design:type", String)
], WalletEntity.prototype, "currency", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 16 }),
    __metadata("design:type", String)
], WalletEntity.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: "created_at", type: "timestamptz" }),
    __metadata("design:type", Date)
], WalletEntity.prototype, "createdAt", void 0);
exports.WalletEntity = WalletEntity = __decorate([
    (0, typeorm_1.Entity)({ name: "wallets" })
], WalletEntity);
let CreditGrantEntity = class CreditGrantEntity {
    grantId;
    walletId;
    kind;
    amountMicro;
    remainingMicro;
    expiresAt;
    restrictProductCodes;
    restrictCapabilities;
    sourceType;
    sourceId;
    revokedMicro;
    revokeShortfallMicro;
    revokedAt;
    createdAt;
};
exports.CreditGrantEntity = CreditGrantEntity;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ name: "grant_id", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], CreditGrantEntity.prototype, "grantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "wallet_id", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], CreditGrantEntity.prototype, "walletId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 32 }),
    __metadata("design:type", String)
], CreditGrantEntity.prototype, "kind", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "amount_micro", type: "bigint", transformer: micro }),
    __metadata("design:type", BigInt)
], CreditGrantEntity.prototype, "amountMicro", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "remaining_micro", type: "bigint", transformer: micro }),
    __metadata("design:type", BigInt)
], CreditGrantEntity.prototype, "remainingMicro", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "expires_at", type: "timestamptz", nullable: true }),
    __metadata("design:type", Object)
], CreditGrantEntity.prototype, "expiresAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "restrict_product_codes", type: "jsonb", nullable: true }),
    __metadata("design:type", Object)
], CreditGrantEntity.prototype, "restrictProductCodes", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "restrict_capabilities", type: "jsonb", nullable: true }),
    __metadata("design:type", Object)
], CreditGrantEntity.prototype, "restrictCapabilities", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "source_type", type: "varchar", length: 32 }),
    __metadata("design:type", String)
], CreditGrantEntity.prototype, "sourceType", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "source_id", type: "varchar", length: 128 }),
    __metadata("design:type", String)
], CreditGrantEntity.prototype, "sourceId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "revoked_micro", type: "bigint", transformer: micro, default: 0 }),
    __metadata("design:type", BigInt)
], CreditGrantEntity.prototype, "revokedMicro", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "revoke_shortfall_micro", type: "bigint", transformer: micro, default: 0 }),
    __metadata("design:type", BigInt)
], CreditGrantEntity.prototype, "revokeShortfallMicro", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "revoked_at", type: "timestamptz", nullable: true }),
    __metadata("design:type", Object)
], CreditGrantEntity.prototype, "revokedAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: "created_at", type: "timestamptz" }),
    __metadata("design:type", Date)
], CreditGrantEntity.prototype, "createdAt", void 0);
exports.CreditGrantEntity = CreditGrantEntity = __decorate([
    (0, typeorm_1.Entity)({ name: "credit_grants" })
], CreditGrantEntity);
let CreditHoldEntity = class CreditHoldEntity {
    holdId;
    walletId;
    requestId;
    amountMicro;
    status;
    expiresAt;
    createdAt;
};
exports.CreditHoldEntity = CreditHoldEntity;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ name: "hold_id", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], CreditHoldEntity.prototype, "holdId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "wallet_id", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], CreditHoldEntity.prototype, "walletId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "request_id", type: "varchar", length: 128 }),
    __metadata("design:type", String)
], CreditHoldEntity.prototype, "requestId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "amount_micro", type: "bigint", transformer: micro }),
    __metadata("design:type", BigInt)
], CreditHoldEntity.prototype, "amountMicro", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 16 }),
    __metadata("design:type", String)
], CreditHoldEntity.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "expires_at", type: "timestamptz" }),
    __metadata("design:type", Date)
], CreditHoldEntity.prototype, "expiresAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: "created_at", type: "timestamptz" }),
    __metadata("design:type", Date)
], CreditHoldEntity.prototype, "createdAt", void 0);
exports.CreditHoldEntity = CreditHoldEntity = __decorate([
    (0, typeorm_1.Entity)({ name: "credit_holds" })
], CreditHoldEntity);
let LedgerEntryEntity = class LedgerEntryEntity {
    entryId;
    walletId;
    grantId;
    holdId;
    kind;
    amountMicro;
    balanceAfterMicro;
    requestId;
    meta;
    createdAt;
};
exports.LedgerEntryEntity = LedgerEntryEntity;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ name: "entry_id", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], LedgerEntryEntity.prototype, "entryId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "wallet_id", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], LedgerEntryEntity.prototype, "walletId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "grant_id", type: "varchar", length: 64, nullable: true }),
    __metadata("design:type", Object)
], LedgerEntryEntity.prototype, "grantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "hold_id", type: "varchar", length: 64, nullable: true }),
    __metadata("design:type", Object)
], LedgerEntryEntity.prototype, "holdId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 32 }),
    __metadata("design:type", String)
], LedgerEntryEntity.prototype, "kind", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "amount_micro", type: "bigint", transformer: micro }),
    __metadata("design:type", BigInt)
], LedgerEntryEntity.prototype, "amountMicro", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "balance_after_micro", type: "bigint", transformer: micro, nullable: true }),
    __metadata("design:type", Object)
], LedgerEntryEntity.prototype, "balanceAfterMicro", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "request_id", type: "varchar", length: 128, nullable: true }),
    __metadata("design:type", Object)
], LedgerEntryEntity.prototype, "requestId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "jsonb" }),
    __metadata("design:type", Object)
], LedgerEntryEntity.prototype, "meta", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: "created_at", type: "timestamptz" }),
    __metadata("design:type", Date)
], LedgerEntryEntity.prototype, "createdAt", void 0);
exports.LedgerEntryEntity = LedgerEntryEntity = __decorate([
    (0, typeorm_1.Entity)({ name: "ledger_entries" })
], LedgerEntryEntity);
let RateCardEntity = class RateCardEntity {
    rateCardId;
    version;
    effectiveFrom;
    createdAt;
};
exports.RateCardEntity = RateCardEntity;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ name: "rate_card_id", type: "varchar", length: 128 }),
    __metadata("design:type", String)
], RateCardEntity.prototype, "rateCardId", void 0);
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: "integer" }),
    __metadata("design:type", Number)
], RateCardEntity.prototype, "version", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "effective_from", type: "timestamptz" }),
    __metadata("design:type", Date)
], RateCardEntity.prototype, "effectiveFrom", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: "created_at", type: "timestamptz" }),
    __metadata("design:type", Date)
], RateCardEntity.prototype, "createdAt", void 0);
exports.RateCardEntity = RateCardEntity = __decorate([
    (0, typeorm_1.Entity)({ name: "rate_cards" })
], RateCardEntity);
let RateCardLineEntity = class RateCardLineEntity {
    lineId;
    rateCardId;
    version;
    capability;
    providerType;
    model;
    unit;
    upstreamCostMicroUsd;
    markupBps;
    fixedFeeMicro;
};
exports.RateCardLineEntity = RateCardLineEntity;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ name: "line_id", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], RateCardLineEntity.prototype, "lineId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "rate_card_id", type: "varchar", length: 128 }),
    __metadata("design:type", String)
], RateCardLineEntity.prototype, "rateCardId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "integer" }),
    __metadata("design:type", Number)
], RateCardLineEntity.prototype, "version", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 64 }),
    __metadata("design:type", String)
], RateCardLineEntity.prototype, "capability", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "provider_type", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], RateCardLineEntity.prototype, "providerType", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 256 }),
    __metadata("design:type", String)
], RateCardLineEntity.prototype, "model", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 64 }),
    __metadata("design:type", String)
], RateCardLineEntity.prototype, "unit", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "upstream_cost_micro_usd", type: "bigint", transformer: micro }),
    __metadata("design:type", BigInt)
], RateCardLineEntity.prototype, "upstreamCostMicroUsd", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "markup_bps", type: "integer" }),
    __metadata("design:type", Number)
], RateCardLineEntity.prototype, "markupBps", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "fixed_fee_micro", type: "bigint", transformer: micro }),
    __metadata("design:type", BigInt)
], RateCardLineEntity.prototype, "fixedFeeMicro", void 0);
exports.RateCardLineEntity = RateCardLineEntity = __decorate([
    (0, typeorm_1.Entity)({ name: "rate_card_lines" })
], RateCardLineEntity);
