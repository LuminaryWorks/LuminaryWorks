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
exports.ConnectionsHealthIndicator = exports.VaultHealthIndicator = void 0;
const common_1 = require("@nestjs/common");
const terminus_1 = require("@nestjs/terminus");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const entities_1 = require("../database/entities");
const policy_1 = require("../policy");
let VaultHealthIndicator = class VaultHealthIndicator {
    healthIndicatorService;
    constructor(healthIndicatorService) {
        this.healthIndicatorService = healthIndicatorService;
    }
    isHealthy(key) {
        const indicator = this.healthIndicatorService.check(key);
        if (!(0, policy_1.vaultKeyUsable)(process.env.AI_VAULT_MASTER_KEY)) {
            return indicator.down("AI_VAULT_MASTER_KEY missing");
        }
        return indicator.up();
    }
};
exports.VaultHealthIndicator = VaultHealthIndicator;
exports.VaultHealthIndicator = VaultHealthIndicator = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [terminus_1.HealthIndicatorService])
], VaultHealthIndicator);
let ConnectionsHealthIndicator = class ConnectionsHealthIndicator {
    healthIndicatorService;
    connections;
    constructor(healthIndicatorService, connections) {
        this.healthIndicatorService = healthIndicatorService;
        this.connections = connections;
    }
    async isHealthy(key) {
        const enabled = await this.connections.count({ where: { enabled: true } });
        return this.healthIndicatorService.check(key).up({ enabled });
    }
};
exports.ConnectionsHealthIndicator = ConnectionsHealthIndicator;
exports.ConnectionsHealthIndicator = ConnectionsHealthIndicator = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.ProviderConnectionEntity)),
    __metadata("design:paramtypes", [terminus_1.HealthIndicatorService,
        typeorm_2.Repository])
], ConnectionsHealthIndicator);
