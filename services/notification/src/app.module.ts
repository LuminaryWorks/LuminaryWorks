import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import notificationConfig, { type NotificationConfig } from "./config/notification.config";
import { ALL_ENTITIES } from "./database/entities";
import { HealthModule } from "./health/health.module";
import { MailModule } from "./mail/mail.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [notificationConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const notification = config.getOrThrow<NotificationConfig>("notification");
        return {
          type: "postgres" as const,
          url: notification.databaseUrl,
          entities: ALL_ENTITIES,
          synchronize: false,
          logging: notification.nodeEnv === "development",
          migrations: ["dist/database/migrations/*.js"],
          migrationsRun: notification.migrationsRun,
        };
      },
    }),
    HealthModule,
    MailModule,
  ],
})
export class AppModule {}
