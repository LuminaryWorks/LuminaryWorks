import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "./auth/auth.guard";
import entitlementConfig from "./config/entitlement.config";
import { ALL_ENTITIES } from "./database/entities";
import { AdminModule } from "./modules/admin/admin.module";
import { AuditModule } from "./modules/audit/audit.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { EntitlementsModule } from "./modules/entitlements/entitlements.module";
import { HealthModule } from "./modules/health/health.module";
import { LicenseModule } from "./modules/license/license.module";
import { NotifyModule } from "./modules/notify/notify.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { PartnerModule } from "./modules/partner/partner.module";
import { TrialsModule } from "./modules/trials/trials.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [entitlementConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        url: config.getOrThrow<string>("entitlement.databaseUrl"),
        entities: ALL_ENTITIES,
        synchronize: config.get<boolean>("entitlement.synchronize") === true,
        logging: config.get<string>("entitlement.nodeEnv") === "development",
        migrations: ["dist/database/migrations/*.js"],
        migrationsRun: config.get<boolean>("entitlement.migrationsRun") === true,
      }),
    }),
    AuditModule,
    CatalogModule,
    EntitlementsModule,
    TrialsModule,
    OrdersModule,
    AdminModule,
    HealthModule,
    PartnerModule,
    LicenseModule,
    NotifyModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
