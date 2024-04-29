import { Module, type DynamicModule, Logger, type Provider } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import type { EntitlementConfig } from "../../config/entitlement.config";
import { NotificationPreferenceEntity } from "../../database/entities/notification-preference.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { PartnerEntity } from "../../database/entities/partner.entity";
import { PartnerModule } from "../partner/partner.module";
import { EmailNotifyAdapter, EMAIL_NOTIFICATION_PORT } from "./email.adapter";
import { InAppNotifyAdapter } from "./in-app.adapter";
import { NotificationPreferenceService } from "./notification-preference.service";
import { NotifyController } from "./notify.controller";
import { NOTIFY_ADAPTERS } from "./notify-adapter";
import { OutboxService } from "./outbox.service";
import { PushNotifyAdapter } from "./push.adapter";

const logger = new Logger("NotifyModule");

type NotificationPkg = {
  NotificationModule: {
    forRootAsync: (opts: {
      imports?: unknown[];
      inject?: unknown[];
      useFactory: (...args: unknown[]) => unknown;
    }) => DynamicModule;
  };
  NotificationService: new (
    ...args: unknown[]
  ) => {
    isConfigured: (channel?: string) => boolean;
    sendEmail: (msg: unknown) => Promise<unknown>;
  };
};

function loadNotificationPkg(): NotificationPkg | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@luminaryworks/notification") as NotificationPkg;
  } catch {
    logger.warn(
      "@luminaryworks/notification not installed — email notify adapter disabled until package is linked",
    );
    return null;
  }
}

const notificationPkg = loadNotificationPkg();

const notificationImports: DynamicModule[] = notificationPkg
  ? [
      notificationPkg.NotificationModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (...args: unknown[]) => {
          const config = args[0] as ConfigService;
          const conf = config.getOrThrow<EntitlementConfig>("entitlement");
          return {
            email: {
              enabled: conf.notificationEmailEnabled && Boolean(conf.smtpHost),
              transport: conf.smtpHost
                ? {
                    host: conf.smtpHost,
                    port: conf.smtpPort,
                    secure: conf.smtpSecure,
                    requireTLS: conf.smtpRequireTls,
                    user: conf.smtpUser,
                    pass: conf.smtpPass,
                  }
                : undefined,
              defaults: { from: conf.mailFrom },
            },
          };
        },
      }),
    ]
  : [];

const emailPortProvider: Provider = notificationPkg
  ? {
      provide: EMAIL_NOTIFICATION_PORT,
      useExisting: notificationPkg.NotificationService,
    }
  : { provide: EMAIL_NOTIFICATION_PORT, useValue: null };

@Module({
  imports: [
    ConfigModule,
    PartnerModule,
    TypeOrmModule.forFeature([OutboxEventEntity, NotificationPreferenceEntity, PartnerEntity]),
    ...notificationImports,
  ],
  controllers: [NotifyController],
  providers: [
    InAppNotifyAdapter,
    EmailNotifyAdapter,
    PushNotifyAdapter,
    NotificationPreferenceService,
    OutboxService,
    emailPortProvider,
    {
      provide: NOTIFY_ADAPTERS,
      useFactory: (
        inApp: InAppNotifyAdapter,
        email: EmailNotifyAdapter,
        push: PushNotifyAdapter,
      ) => [inApp, email, push],
      inject: [InAppNotifyAdapter, EmailNotifyAdapter, PushNotifyAdapter],
    },
  ],
  exports: [OutboxService, NotificationPreferenceService, InAppNotifyAdapter, PushNotifyAdapter],
})
export class NotifyModule {}
