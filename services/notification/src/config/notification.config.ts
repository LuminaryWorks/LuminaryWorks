export interface SmtpEnv {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  secure: boolean;
  requireTLS: boolean;
  dailyQuota: number;
  monthlyQuota: number;
}

export interface NotificationConfig {
  port: number;
  databaseUrl: string;
  serviceKey: string;
  secretKey: string;
  emailAuthEnabled: boolean;
  migrationsRun: boolean;
  nodeEnv: string;
  from: string;
  fromName: string;
  resendApiKey?: string;
  resendDailyQuota: number;
  resendMonthlyQuota: number;
  brevoApiKey?: string;
  brevoDailyQuota: number;
  brevoMonthlyQuota: number;
  mailgunApiKey?: string;
  /** MAILGUN_DOMAIN. The verified domain that may send MAIL_FROM. */
  mailgunDomain?: string;
  mailgunDailyQuota: number;
  mailgunMonthlyQuota: number;
  smtp?: SmtpEnv;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value === "true" || value === "TRUE";
}

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadNotificationConfig(
  env: Record<string, string | undefined> = process.env,
): NotificationConfig {
  const smtpHost = env.SMTP_HOST?.trim();
  const smtpPort = integer(env.SMTP_PORT, 587);
  const secure = flag(env.SMTP_SECURE, smtpPort === 465);
  return {
    port: integer(env.NOTIFICATION_PORT, 3050),
    databaseUrl:
      env.NOTIFICATION_DATABASE_URL?.trim() ||
      "postgres://notification:notification_dev@localhost:5435/notification",
    serviceKey: env.NOTIFICATION_SERVICE_KEY?.trim() ?? "",
    secretKey: env.NOTIFICATION_SECRET_KEY?.trim() ?? "",
    emailAuthEnabled: flag(env.EMAIL_AUTH_ENABLED, true),
    migrationsRun: flag(env.NOTIFICATION_MIGRATIONS_RUN, true),
    nodeEnv: env.NODE_ENV?.trim() || "development",
    from: env.MAIL_FROM?.trim() ?? "",
    fromName: env.MAIL_FROM_NAME?.trim() ?? "",
    resendApiKey: env.RESEND_API_KEY?.trim() || undefined,
    resendDailyQuota: integer(env.RESEND_DAILY_QUOTA, 100),
    resendMonthlyQuota: integer(env.RESEND_MONTHLY_QUOTA, 3000),
    brevoApiKey: env.BREVO_API_KEY?.trim() || undefined,
    brevoDailyQuota: integer(env.BREVO_DAILY_QUOTA, 300),
    brevoMonthlyQuota: integer(env.BREVO_MONTHLY_QUOTA, 9000),
    mailgunApiKey: env.MAILGUN_API_KEY?.trim() || undefined,
    mailgunDomain: env.MAILGUN_DOMAIN?.trim().toLowerCase() || undefined,
    mailgunDailyQuota: integer(env.MAILGUN_DAILY_QUOTA, 0),
    mailgunMonthlyQuota: integer(env.MAILGUN_MONTHLY_QUOTA, 0),
    smtp: smtpHost
      ? {
          host: smtpHost,
          port: smtpPort,
          user: env.SMTP_USER?.trim() || undefined,
          pass: env.SMTP_PASS ?? undefined,
          secure,
          requireTLS: flag(env.SMTP_REQUIRE_TLS, !secure && smtpPort === 587),
          dailyQuota: integer(env.SMTP_DAILY_QUOTA, 0),
          monthlyQuota: integer(env.SMTP_MONTHLY_QUOTA, 0),
        }
      : undefined,
  };
}

export default function notificationConfig() {
  return { notification: loadNotificationConfig() };
}
