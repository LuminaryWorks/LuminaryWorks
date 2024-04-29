import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EntitlementConfig } from "../../config/entitlement.config";
import type { NotifyAdapter, NotifyMessage } from "./notify-adapter";

/** Minimal surface of @luminaryworks/notification NotificationService. */
export interface EmailNotificationPort {
  isConfigured(channel?: string): boolean;
  sendEmail(msg: {
    from: string;
    to: string[];
    subject: string;
    text?: string;
    html?: string;
  }): Promise<unknown>;
}

export const EMAIL_NOTIFICATION_PORT = Symbol("EMAIL_NOTIFICATION_PORT");

@Injectable()
export class EmailNotifyAdapter implements NotifyAdapter {
  readonly channel = "email" as const;
  private readonly logger = new Logger(EmailNotifyAdapter.name);

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(EMAIL_NOTIFICATION_PORT)
    private readonly notification?: EmailNotificationPort | null,
  ) {}

  private getConf(): EntitlementConfig {
    return this.config.getOrThrow<EntitlementConfig>("entitlement");
  }

  isConfigured(): boolean {
    const conf = this.getConf();
    if (!conf.notificationEmailEnabled || !conf.mailFrom) return false;
    if (!this.notification) return false;
    try {
      return this.notification.isConfigured("email");
    } catch {
      return false;
    }
  }

  async send(message: NotifyMessage): Promise<void> {
    const conf = this.getConf();
    const to = message.emailAddress;
    if (!to) {
      this.logger.warn(`email skipped: no address for ${message.logtoSub}`);
      return;
    }
    if (!this.notification || !this.isConfigured()) {
      throw new Error("Email channel not configured (@luminaryworks/notification + SMTP)");
    }
    await this.notification.sendEmail({
      from: conf.mailFrom!,
      to: [to],
      subject: message.title,
      text: message.body,
      html: `<p>${escapeHtml(message.body)}</p>`,
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
