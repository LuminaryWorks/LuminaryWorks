import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AiGatewayController } from "./ai-gateway.controller";
import { AiGatewayService } from "./ai-gateway.service";
import { AuthGuard } from "./auth/auth.guard";
import aiPlatformConfig, { type AiPlatformConfig } from "./config/ai-platform.config";
import { ALL_ENTITIES } from "./database/entities";
import { AiPlatformInitial1762406400000 } from "./database/migrations/1762406400000-AiPlatformInitial";
import { AiPlatformWallet1762500000000 } from "./database/migrations/1762500000000-AiPlatformWallet";
import { EntitlementGate } from "./entitlement-gate";
import { HealthModule } from "./health/health.module";
import { PublicIngressHook } from "./public-ingress.hook";
import { ChatV2Controller } from "./v2/chat-v2.controller";
import { CreditsController } from "./wallet/credits.controller";
import { WalletService } from "./wallet/wallet.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [aiPlatformConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const settings = config.getOrThrow<AiPlatformConfig>("aiPlatform");
        return {
          type: "postgres" as const,
          url: settings.databaseUrl,
          entities: ALL_ENTITIES,
          synchronize: false,
          logging: settings.nodeEnv === "development",
          migrations: [AiPlatformInitial1762406400000, AiPlatformWallet1762500000000],
          migrationsRun: settings.migrationsRun,
        };
      },
    }),
    TypeOrmModule.forFeature(ALL_ENTITIES),
    HealthModule,
  ],
  controllers: [AiGatewayController, ChatV2Controller, CreditsController],
  providers: [
    AiGatewayService,
    WalletService,
    EntitlementGate,
    PublicIngressHook,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
