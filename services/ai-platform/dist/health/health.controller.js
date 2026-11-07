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
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const terminus_1 = require("@nestjs/terminus");
const decorators_1 = require("../auth/decorators");
const health_indicators_1 = require("./health.indicators");
let HealthController = class HealthController {
    health;
    db;
    vault;
    connections;
    constructor(health, db, vault, connections) {
        this.health = health;
        this.db = db;
        this.vault = vault;
        this.connections = connections;
    }
    /** Liveness only. Does not probe Postgres or the vault. */
    liveness() {
        return { ok: true, service: "luminary-ai-platform" };
    }
    /**
     * Critical dependencies: Postgres and the vault master key.
     * Enabled connection count is reported and does not fail readiness.
     */
    readiness() {
        return this.health.check([
            () => this.db.pingCheck("database"),
            () => this.vault.isHealthy("vault"),
            () => this.connections.isHealthy("connections"),
        ]);
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, decorators_1.Public)(),
    (0, common_1.Get)("v1/health"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "liveness", null);
__decorate([
    (0, decorators_1.Public)(),
    (0, common_1.Get)("ready"),
    (0, terminus_1.HealthCheck)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "readiness", null);
exports.HealthController = HealthController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [terminus_1.HealthCheckService,
        terminus_1.TypeOrmHealthIndicator,
        health_indicators_1.VaultHealthIndicator,
        health_indicators_1.ConnectionsHealthIndicator])
], HealthController);
