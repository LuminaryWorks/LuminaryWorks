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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditsController = void 0;
const common_1 = require("@nestjs/common");
const auth_types_1 = require("../auth/auth.types");
const authz_1 = require("../authz");
const errors_1 = require("../common/errors");
const rate_card_1 = require("./rate-card");
const wallet_service_1 = require("./wallet.service");
let CreditsController = class CreditsController {
    wallet;
    constructor(wallet) {
        this.wallet = wallet;
    }
    async grant(body, req) {
        (0, authz_1.assertInternalService)(principalOf(req));
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
        return (0, wallet_service_1.amountsToJson)({ orderId: input.orderId, ...result });
    }
    async revoke(body, req) {
        (0, authz_1.assertInternalService)(principalOf(req));
        const input = parseRevoke(body);
        const result = await this.wallet.revokeBySource("order", input.orderId, input.amountMicro === undefined ? undefined : BigInt(input.amountMicro));
        return (0, wallet_service_1.amountsToJson)({ orderId: input.orderId, ...result });
    }
    async publishRateCard(body, req) {
        (0, authz_1.assertInternalService)(principalOf(req));
        const input = parseRateCard(body);
        return this.wallet.publishRateCard({
            id: input.id,
            version: input.version,
            effectiveFrom: input.effectiveFrom,
            lines: input.lines,
        });
    }
};
exports.CreditsController = CreditsController;
__decorate([
    (0, common_1.Post)("v1/internal/credits/grant"),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CreditsController.prototype, "grant", null);
__decorate([
    (0, common_1.Post)("v1/internal/credits/revoke"),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CreditsController.prototype, "revoke", null);
__decorate([
    (0, common_1.Post)("v1/internal/rate-cards"),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CreditsController.prototype, "publishRateCard", null);
exports.CreditsController = CreditsController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [wallet_service_1.WalletService])
], CreditsController);
function principalOf(req) {
    const principal = req[auth_types_1.AI_PRINCIPAL];
    if (!principal) {
        throw new common_1.UnauthorizedException({
            error: { code: "AUTH_REQUIRED", message: "Authentication required" },
        });
    }
    return principal;
}
function parseGrant(body) {
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
function parseRevoke(body) {
    const row = record(body);
    const orderId = requiredString(row, "orderId");
    if (row.amountMicro === undefined)
        return { orderId };
    return { orderId, amountMicro: nonNegativeInt(row.amountMicro, "amountMicro") };
}
function parseRateCard(body) {
    const row = record(body);
    const id = requiredString(row, "id");
    const version = positiveInt(row.version, "version");
    const effectiveFrom = dateOf(row.effectiveFrom, "effectiveFrom");
    if (!Array.isArray(row.lines) || row.lines.length === 0) {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "lines are required");
    }
    const lines = row.lines.map((line) => {
        const item = record(line);
        const unit = requiredString(item, "unit");
        if (!(0, rate_card_1.isRateUnit)(unit))
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "unit is invalid");
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
function parseOwner(value) {
    const row = record(value);
    const kind = row.kind;
    if (kind !== "user" && kind !== "organization") {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "walletOwner.kind is invalid");
    }
    return { kind, id: requiredString(row, "id") };
}
function parseRestrict(value) {
    const row = record(value);
    return {
        productCodes: row.productCodes === undefined ? undefined : stringList(row.productCodes, "productCodes"),
        capabilities: row.capabilities === undefined ? undefined : stringList(row.capabilities, "capabilities"),
    };
}
function record(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "Request body must be an object");
    }
    return value;
}
function requiredString(row, key) {
    const value = row[key];
    if (typeof value !== "string" || value.trim() === "") {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, `${key} is required`);
    }
    return value.trim();
}
function positiveInt(value, key) {
    const parsed = nonNegativeInt(value, key);
    if (parsed <= 0)
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, `${key} must be positive`);
    return parsed;
}
function nonNegativeInt(value, key) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, `${key} must be a non-negative integer`);
    }
    return value;
}
function currencyOf(value) {
    if (value !== "USD" && value !== "CNY") {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "currency is invalid");
    }
    return value;
}
function kindOf(value) {
    if (value !== "topup" && value !== "subscription" && value !== "promo" && value !== "trial" && value !== "refund_reversal") {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "kind is invalid");
    }
    return value;
}
function dateOf(value, key) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, `${key} must be an ISO date`);
    }
    return new Date(value);
}
function stringList(value, key) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, `${key} must be an array of strings`);
    }
    return value.map((item) => item.trim());
}
