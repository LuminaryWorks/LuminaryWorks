"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const typeorm_1 = require("@nestjs/typeorm");
const ai_gateway_controller_1 = require("./ai-gateway.controller");
const ai_gateway_service_1 = require("./ai-gateway.service");
const auth_guard_1 = require("./auth/auth.guard");
const ai_platform_config_1 = __importDefault(require("./config/ai-platform.config"));
const entities_1 = require("./database/entities");
const _1762406400000_AiPlatformInitial_1 = require("./database/migrations/1762406400000-AiPlatformInitial");
const _1762500000000_AiPlatformWallet_1 = require("./database/migrations/1762500000000-AiPlatformWallet");
const entitlement_gate_1 = require("./entitlement-gate");
const health_module_1 = require("./health/health.module");
const public_ingress_hook_1 = require("./public-ingress.hook");
const chat_v2_controller_1 = require("./v2/chat-v2.controller");
const credits_controller_1 = require("./wallet/credits.controller");
const wallet_service_1 = require("./wallet/wallet.service");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [ai_platform_config_1.default],
            }),
            typeorm_1.TypeOrmModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => {
                    const settings = config.getOrThrow("aiPlatform");
                    return {
                        type: "postgres",
                        url: settings.databaseUrl,
                        entities: entities_1.ALL_ENTITIES,
                        synchronize: false,
                        logging: settings.nodeEnv === "development",
                        migrations: [_1762406400000_AiPlatformInitial_1.AiPlatformInitial1762406400000, _1762500000000_AiPlatformWallet_1.AiPlatformWallet1762500000000],
                        migrationsRun: settings.migrationsRun,
                    };
                },
            }),
            typeorm_1.TypeOrmModule.forFeature(entities_1.ALL_ENTITIES),
            health_module_1.HealthModule,
        ],
        controllers: [ai_gateway_controller_1.AiGatewayController, chat_v2_controller_1.ChatV2Controller, credits_controller_1.CreditsController],
        providers: [
            ai_gateway_service_1.AiGatewayService,
            wallet_service_1.WalletService,
            entitlement_gate_1.EntitlementGate,
            public_ingress_hook_1.PublicIngressHook,
            {
                provide: core_1.APP_GUARD,
                useClass: auth_guard_1.AuthGuard,
            },
        ],
    })
], AppModule);
