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
exports.ProviderConnectionEntity = void 0;
const typeorm_1 = require("typeorm");
let ProviderConnectionEntity = class ProviderConnectionEntity {
    uid;
    ownerKind;
    ownerUid;
    providerType;
    displayName;
    baseUrl;
    model;
    enabled;
    isDefault;
    purpose;
    extra;
    secretFingerprint;
    ciphertext;
    createdAt;
    updatedAt;
};
exports.ProviderConnectionEntity = ProviderConnectionEntity;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: "varchar", length: 64 }),
    __metadata("design:type", String)
], ProviderConnectionEntity.prototype, "uid", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "owner_kind", type: "varchar", length: 32 }),
    __metadata("design:type", String)
], ProviderConnectionEntity.prototype, "ownerKind", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "owner_uid", type: "varchar", length: 128 }),
    __metadata("design:type", String)
], ProviderConnectionEntity.prototype, "ownerUid", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "provider_type", type: "varchar", length: 64 }),
    __metadata("design:type", String)
], ProviderConnectionEntity.prototype, "providerType", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "display_name", type: "varchar", length: 256 }),
    __metadata("design:type", String)
], ProviderConnectionEntity.prototype, "displayName", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "base_url", type: "varchar", length: 2048, nullable: true }),
    __metadata("design:type", Object)
], ProviderConnectionEntity.prototype, "baseUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 256 }),
    __metadata("design:type", String)
], ProviderConnectionEntity.prototype, "model", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "boolean", default: true }),
    __metadata("design:type", Boolean)
], ProviderConnectionEntity.prototype, "enabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "is_default", type: "boolean", default: false }),
    __metadata("design:type", Boolean)
], ProviderConnectionEntity.prototype, "isDefault", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "varchar", length: 128, nullable: true }),
    __metadata("design:type", Object)
], ProviderConnectionEntity.prototype, "purpose", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "jsonb", nullable: true }),
    __metadata("design:type", Object)
], ProviderConnectionEntity.prototype, "extra", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: "secret_fingerprint", type: "varchar", length: 16, nullable: true }),
    __metadata("design:type", Object)
], ProviderConnectionEntity.prototype, "secretFingerprint", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: "text", nullable: true }),
    __metadata("design:type", Object)
], ProviderConnectionEntity.prototype, "ciphertext", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: "created_at", type: "timestamptz" }),
    __metadata("design:type", Date)
], ProviderConnectionEntity.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: "updated_at", type: "timestamptz" }),
    __metadata("design:type", Date)
], ProviderConnectionEntity.prototype, "updatedAt", void 0);
exports.ProviderConnectionEntity = ProviderConnectionEntity = __decorate([
    (0, typeorm_1.Entity)({ name: "provider_connections" })
], ProviderConnectionEntity);
