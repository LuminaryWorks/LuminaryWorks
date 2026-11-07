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
exports.AiUsageEventEntity = void 0;
const typeorm_1 = require("typeorm");
const micro = {
    to: (value) => (value == null ? null : String(Math.trunc(value))),
    from: (value) => (value == null ? null : Number(value)),
};
let AiUsageEventEntity = class AiUsageEventEntity {
    id;
    productCode;
    subjectId;
    organizationId;
    conversationUid;
    feature;
    purpose;
    providerType;
    model;
    promptTokens;
    completionTokens;
    audioInputMs;
    audioOutputMs;
    latencyMs;
    firstTokenMs;
    cacheHit;
    routeTier;
    estimatedCostMinor;
    billed;
    status;
    traceId;
    at;
    walletId;
    grantIds;
    rateCardId;
    rateCardVersion;
    upstreamCostMicroUsd;
    chargedMicro;
    routeId;
    attemptIndex;
    partial;
    surface;
    apiKeyId;
};
exports.AiUsageEventEntity = AiUsageEventEntity;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: "uuid" }),
    __metadata("design:type", String)
], AiUsageEventEntity.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ name: "product_code", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], AiUsageEventEntity.prototype, "productCode", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ name: "subject_id", type: "varchar", length: 128 }),
    __metadata("design:type", String)
], AiUsageEventEntity.prototype, "subjectId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "organization_id", type: "varchar", length: 128, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "organizationId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "conversation_uid", type: "varchar", length: 128, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "conversationUid", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 128, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "feature", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 32, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "purpose", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "provider_type", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], AiUsageEventEntity.prototype, "providerType", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 256 }),
    __metadata("design:type", String)
], AiUsageEventEntity.prototype, "model", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "prompt_tokens", type: "integer", default: 0 }),
    __metadata("design:type", Number)
], AiUsageEventEntity.prototype, "promptTokens", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "completion_tokens", type: "integer", default: 0 }),
    __metadata("design:type", Number)
], AiUsageEventEntity.prototype, "completionTokens", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "audio_input_ms", type: "integer", nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "audioInputMs", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "audio_output_ms", type: "integer", nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "audioOutputMs", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "latency_ms", type: "integer", nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "latencyMs", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "first_token_ms", type: "integer", nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "firstTokenMs", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "cache_hit", type: "boolean", nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "cacheHit", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "route_tier", type: "varchar", length: 32, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "routeTier", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "estimated_cost_minor", type: "integer", nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "estimatedCostMinor", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 16 }),
    __metadata("design:type", String)
], AiUsageEventEntity.prototype, "billed", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 32, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "trace_id", type: "varchar", length: 128, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "traceId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: "timestamptz" }),
    __metadata("design:type", Date)
], AiUsageEventEntity.prototype, "at", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "wallet_id", type: "varchar", length: 128, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "walletId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "grant_ids", type: "jsonb", nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "grantIds", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "rate_card_id", type: "varchar", length: 128, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "rateCardId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "rate_card_version", type: "varchar", length: 64, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "rateCardVersion", void 0);
__decorate([
    (0, typeorm_1.Column)({
        name: "upstream_cost_micro_usd",
        type: "bigint",
        nullable: true,
        transformer: micro,
    }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "upstreamCostMicroUsd", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "charged_micro", type: "bigint", nullable: true, transformer: micro }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "chargedMicro", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "route_id", type: "varchar", length: 128, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "routeId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "attempt_index", type: "integer", nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "attemptIndex", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "boolean", nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "partial", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 16, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "surface", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "api_key_id", type: "varchar", length: 128, nullable: true }),
    __metadata("design:type", Object)
], AiUsageEventEntity.prototype, "apiKeyId", void 0);
exports.AiUsageEventEntity = AiUsageEventEntity = __decorate([
    (0, typeorm_1.Entity)({ name: "ai_usage_events" })
], AiUsageEventEntity);
