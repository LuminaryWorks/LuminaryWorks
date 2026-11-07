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
exports.EntitlementGate = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const entitlement_client_1 = require("@luminaryworks/entitlement-client");
const errors_1 = require("./common/errors");
const policy_1 = require("./policy");
/**
 * Hosted calls must pass an Entitlement feature check. Fail closed when the
 * service cannot confirm the answer. BYOK callers should not reach this gate.
 */
let EntitlementGate = class EntitlementGate {
    config;
    cache = new Map();
    client = null;
    constructor(config) {
        this.config = config;
    }
    async assertManaged(input) {
        const productCode = input.productCode?.trim() ?? "";
        const subjectId = input.subjectId?.trim() ?? "";
        const feature = input.feature?.trim() ?? "";
        if (!productCode || !subjectId || !feature) {
            throw new errors_1.AiPlatformException("ENTITLEMENT_DENIED", 403, "Managed calls require productCode, subjectId, and feature");
        }
        const key = (0, policy_1.entitlementCacheKey)(subjectId, feature, productCode);
        const hit = this.cache.get(key);
        if (hit && hit.expiresAt > Date.now()) {
            if (!hit.allowed) {
                throw new errors_1.AiPlatformException("ENTITLEMENT_DENIED", 403, "Entitlement feature denied");
            }
            return;
        }
        const conf = this.config.getOrThrow("aiPlatform");
        if (!conf.entitlementBaseUrl) {
            throw new errors_1.AiPlatformException("ENTITLEMENT_DENIED", 503, "Entitlement unreachable");
        }
        try {
            const results = await this.getClient(conf).check({
                productCode,
                subjectId,
                features: [{ featureCode: feature }],
            });
            const allowed = results.some((row) => row.featureCode === feature && row.allowed);
            this.cache.set(key, { allowed, expiresAt: Date.now() + policy_1.ENTITLEMENT_CACHE_TTL_MS });
            if (!allowed) {
                throw new errors_1.AiPlatformException("ENTITLEMENT_DENIED", 403, "Entitlement feature denied");
            }
        }
        catch (error) {
            if (error instanceof errors_1.AiPlatformException)
                throw error;
            throw new errors_1.AiPlatformException("ENTITLEMENT_DENIED", 503, "Entitlement unreachable");
        }
    }
    getClient(conf) {
        if (!this.client) {
            this.client = new entitlement_client_1.EntitlementClient({
                baseUrl: conf.entitlementBaseUrl,
                mode: "enforce",
                serviceApiKey: conf.entitlementServiceKey || undefined,
                cacheTtlMs: policy_1.ENTITLEMENT_CACHE_TTL_MS,
                offlineGraceMs: 0,
            });
        }
        return this.client;
    }
};
exports.EntitlementGate = EntitlementGate;
exports.EntitlementGate = EntitlementGate = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], EntitlementGate);
