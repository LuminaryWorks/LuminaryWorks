import {
  AuthMailDeliveryError,
  AuthMailNotConfiguredError,
  AuthMailUnknownOutcomeError,
  buildAuthMailIdempotencyKey,
  createBrevoProvider,
  createMailgunProvider,
  createResendProvider,
  createSmtpProvider,
  recipientDomain,
  resolveByoProfile,
  sendWithChain,
  type ByoMailProfile,
  type ChainProvider,
  type EmailProvider,
} from "@luminaryworks/notification";
import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { NotificationConfig } from "../config/notification.config";
import { openJson } from "../crypto/seal";
import { EmailMessageEntity } from "../database/entities/email-message.entity";
import { MailProfileEntity } from "../database/entities/mail-profile.entity";
import { PgIdempotencyStore } from "./idempotency.store";
import { parseLogtoEmail } from "./logto-email";
import type { StoredCredentials } from "./profile-input";
import { QuotaService } from "./quota.service";
import { renderAuthMail } from "./templates";

@Injectable()
export class AuthMailService {
  private readonly logger = new Logger(AuthMailService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(MailProfileEntity)
    private readonly profiles: Repository<MailProfileEntity>,
    @InjectRepository(EmailMessageEntity)
    private readonly messages: Repository<EmailMessageEntity>,
    private readonly quota: QuotaService,
  ) {}

  async acceptLogto(body: unknown): Promise<{ ok: true; messageId: string }> {
    const settings = this.settings();
    if (!settings.emailAuthEnabled) {
      throw new ServiceUnavailableException("email_auth_disabled");
    }
    const parsed = parseLogtoEmail(body);
    const rows = await this.profiles.find({ where: { enabled: true, usage: "auth" } });
    const byo = resolveByoProfile({
      organizationId: parsed.organizationId,
      recipient: parsed.to,
      profiles: rows.map(toByo),
    });
    const from = byo ? rows.find((row) => row.id === byo.id) : undefined;
    if (byo && !from) {
      throw new ServiceUnavailableException("email_profile_missing");
    }
    if (!from && !settings.from) {
      throw new ServiceUnavailableException("mail_from_not_configured");
    }
    const providers = from
      ? await this.byoChain(from, settings)
      : await this.platformChain(settings, rows);
    const rendered = renderAuthMail(parsed);
    const idempotencyKey = buildAuthMailIdempotencyKey({
      to: parsed.to,
      type: parsed.type,
      code: parsed.code,
      link: parsed.link,
    });
    try {
      const result = await sendWithChain({
        message: {
          from: from?.fromAddress ?? settings.from,
          fromName: from?.fromName ?? settings.fromName,
          to: parsed.to,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          usage: "auth",
          idempotencyKey,
        },
        providers,
        idempotency: new PgIdempotencyStore(this.messages, { type: parsed.type, to: parsed.to }),
        onAccepted: (providerId) => this.quota.increment(providerId),
      });
      this.logger.log(
        `auth mail type=${parsed.type} domain=${recipientDomain(parsed.to) ?? "-"} provider=${result.providerId} replay=${result.idempotentReplay}`,
      );
      return { ok: true, messageId: result.providerMessageId };
    } catch (err) {
      if (err instanceof AuthMailNotConfiguredError) {
        throw new ServiceUnavailableException("email_provider_not_configured");
      }
      if (err instanceof AuthMailUnknownOutcomeError) {
        throw new GatewayTimeoutException("email_delivery_unknown");
      }
      if (err instanceof AuthMailDeliveryError) {
        throw new BadGatewayException("email_delivery_failed");
      }
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) throw err;
      this.logger.error(err instanceof Error ? err.message : "auth mail failed");
      throw new BadGatewayException("email_delivery_failed");
    }
  }

  private async byoChain(profile: MailProfileEntity, settings: NotificationConfig): Promise<ChainProvider[]> {
    const credentials = openJson<StoredCredentials>(profile.credentialsCipher, settings.secretKey);
    const counts = await this.quota.counts(`profile:${profile.id}`);
    return [
      {
        provider: providerFrom(`profile:${profile.id}`, credentials),
        usage: "auth",
        enabled: true,
        priority: profile.priority,
        dailyQuota: profile.dailyQuota,
        monthlyQuota: profile.monthlyQuota,
        ...counts,
      },
    ];
  }

  private async platformChain(
    settings: NotificationConfig,
    rows: MailProfileEntity[],
  ): Promise<ChainProvider[]> {
    const providers: ChainProvider[] = [];
    if (settings.resendApiKey) {
      providers.push(
        await this.envProvider(
          createResendProvider({ id: "platform:resend", apiKey: settings.resendApiKey }),
          1,
          settings.resendDailyQuota,
          settings.resendMonthlyQuota,
        ),
      );
    }
    if (settings.brevoApiKey) {
      providers.push(
        await this.envProvider(
          createBrevoProvider({ id: "platform:brevo", apiKey: settings.brevoApiKey }),
          2,
          settings.brevoDailyQuota,
          settings.brevoMonthlyQuota,
        ),
      );
    }
    if (settings.mailgunApiKey && settings.mailgunDomain) {
      providers.push(
        await this.envProvider(
          createMailgunProvider({
            id: "platform:mailgun",
            apiKey: settings.mailgunApiKey,
            domain: settings.mailgunDomain,
          }),
          3,
          settings.mailgunDailyQuota,
          settings.mailgunMonthlyQuota,
        ),
      );
    }
    if (settings.smtp) {
      providers.push(
        await this.envProvider(
          createSmtpProvider({
            id: "platform:smtp",
            host: settings.smtp.host,
            port: settings.smtp.port,
            user: settings.smtp.user,
            pass: settings.smtp.pass,
            secure: settings.smtp.secure,
            requireTLS: settings.smtp.requireTLS,
          }),
          4,
          settings.smtp.dailyQuota,
          settings.smtp.monthlyQuota,
        ),
      );
    }
    for (const row of rows.filter((item) => item.scope === "platform" && item.verified)) {
      const [chain] = await this.byoChain(row, settings);
      if (chain) providers.push(chain);
    }
    return providers;
  }

  private async envProvider(
    provider: EmailProvider,
    priority: number,
    dailyQuota: number,
    monthlyQuota: number,
  ): Promise<ChainProvider> {
    const counts = await this.quota.counts(provider.id);
    return {
      provider,
      usage: "auth",
      enabled: true,
      priority,
      dailyQuota,
      monthlyQuota,
      ...counts,
    };
  }

  private settings(): NotificationConfig {
    return this.config.getOrThrow<NotificationConfig>("notification");
  }
}

function toByo(row: MailProfileEntity): ByoMailProfile {
  return {
    id: row.id,
    scope: row.scope,
    organizationId: row.organizationId,
    from: row.fromAddress,
    fromName: row.fromName,
    matchDomains: row.matchDomains ?? [],
    verified: row.verified,
    enabled: row.enabled,
    priority: row.priority,
  };
}

function providerFrom(id: string, credentials: StoredCredentials): EmailProvider {
  if (credentials.provider === "brevo") return createBrevoProvider({ id, apiKey: credentials.apiKey });
  if (credentials.provider === "resend") return createResendProvider({ id, apiKey: credentials.apiKey });
  if (credentials.provider === "mailgun") {
    return createMailgunProvider({ id, apiKey: credentials.apiKey, domain: credentials.domain });
  }
  return createSmtpProvider({
    id,
    host: credentials.host,
    port: credentials.port,
    user: credentials.user,
    pass: credentials.pass,
    secure: credentials.secure,
    requireTLS: credentials.requireTLS,
  });
}
