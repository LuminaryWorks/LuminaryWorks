import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import type { DataSource, Repository } from "typeorm";
import type { EntitlementConfig } from "../../config/entitlement.config";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { PartnerEntity } from "../../database/entities/partner.entity";
import { PartnerWebhookService } from "../partner/partner-webhook.service";
import { NotificationPreferenceService } from "./notification-preference.service";
import type { NotifyAdapter, NotifyMessage } from "./notify-adapter";
import { NOTIFY_ADAPTERS } from "./notify-adapter";
import { leaseExpiresAt, nextStatusAfterFailure, OUTBOX_CLAIM_SQL } from "./outbox-claim";
import { outboxBackoffSeconds } from "./outbox-policy";

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OutboxEventEntity)
    private readonly outbox: Repository<OutboxEventEntity>,
    @InjectRepository(PartnerEntity)
    private readonly partners: Repository<PartnerEntity>,
    @Inject(NOTIFY_ADAPTERS) private readonly adapters: NotifyAdapter[],
    private readonly prefs: NotificationPreferenceService,
    private readonly partnerWebhooks: PartnerWebhookService,
  ) {}

  private getConf(): EntitlementConfig {
    return this.config.getOrThrow<EntitlementConfig>("entitlement");
  }

  onModuleInit(): void {
    const conf = this.getConf();
    this.timer = setInterval(() => {
      void this.poll();
    }, conf.outboxPollIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Cancel pending trial notifications after paid upgrade (also used from OrdersService). */
  async cancelTrialNotifications(logtoSub: string, productCode: string): Promise<number> {
    const result = await this.outbox
      .createQueryBuilder()
      .update(OutboxEventEntity)
      .set({ status: "canceled", lockedUntil: null, lockedBy: null })
      .where("status IN (:...st)", { st: ["pending", "failed", "processing"] })
      .andWhere("event_type IN (:...types)", {
        types: ["trial.expiring", "trial.expired"],
      })
      .andWhere("payload->>'logtoSub' = :sub", { sub: logtoSub })
      .andWhere("payload->>'productCode' = :productCode", { productCode })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Claim a due batch with FOR UPDATE SKIP LOCKED, then deliver.
   * Safe across multiple service instances; expired leases are reclaimable.
   */
  async poll(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const claimed = await this.claimBatch();
      let processed = 0;
      for (const event of claimed) {
        await this.deliverOne(event);
        processed += 1;
      }
      return processed;
    } catch (err) {
      this.logger.error(`outbox poll failed: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Atomic claim — exposed for tests / admin force-poll. */
  async claimBatch(now = new Date()): Promise<OutboxEventEntity[]> {
    const conf = this.getConf();
    const leaseUntil = leaseExpiresAt(now, conf.outboxLeaseSeconds);
    const rows = (await this.dataSource.query(OUTBOX_CLAIM_SQL, [
      now,
      conf.outboxBatchSize,
      leaseUntil,
      conf.outboxWorkerId,
    ])) as Record<string, unknown>[];
    return rows.map((r) => this.outbox.create(normalizeClaimRow(r)));
  }

  private async deliverOne(event: OutboxEventEntity): Promise<void> {
    const conf = this.getConf();

    try {
      if (event.eventType.startsWith("partner.")) {
        await this.deliverPartnerWebhook(event);
      } else if (event.eventType === "trial.expiring" || event.eventType === "trial.expired") {
        await this.deliverTrialNotify(event);
      } else {
        this.logger.warn(`No handler for outbox event_type=${event.eventType}; marking sent`);
      }
      event.status = "sent";
      event.lastError = null;
      event.nextAttemptAt = null;
      event.lockedUntil = null;
      event.lockedBy = null;
      await this.outbox.save(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      event.lastError = message.slice(0, 2000);
      const maxAttempts = event.maxAttempts || conf.outboxMaxAttempts;
      const next = nextStatusAfterFailure({ attempts: event.attempts, maxAttempts });
      if (next === "dead") {
        event.status = "dead";
        event.deadLetteredAt = new Date();
        event.lockedUntil = null;
        event.lockedBy = null;
        this.logger.error(`Outbox dead-letter id=${event.id} type=${event.eventType}: ${message}`);
      } else {
        event.status = "failed";
        event.lockedUntil = null;
        event.lockedBy = null;
        const backoffSec = outboxBackoffSeconds(event.attempts);
        event.nextAttemptAt = new Date(Date.now() + backoffSec * 1000);
        this.logger.warn(
          `Outbox retry id=${event.id} attempt=${event.attempts} next=${event.nextAttemptAt.toISOString()} err=${message}`,
        );
      }
      await this.outbox.save(event);
    }
  }

  private async deliverPartnerWebhook(event: OutboxEventEntity): Promise<void> {
    const partnerId = String(event.payload.partnerId ?? "");
    const webhookUrl = String(event.payload.webhookUrl ?? "");
    if (!partnerId || !webhookUrl) throw new Error("Missing partner webhook target");
    const partner = await this.partners.findOne({ where: { id: partnerId } });
    if (!partner?.webhookSecret) throw new Error("Partner webhook secret missing");

    const body = JSON.stringify({
      event_type: event.eventType,
      ...event.payload,
      deliveredAt: new Date().toISOString(),
    });
    const headers = this.partnerWebhooks.signOutbound(partner, body);
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Partner webhook HTTP ${res.status}`);
    }
  }

  private async deliverTrialNotify(event: OutboxEventEntity): Promise<void> {
    const logtoSub = String(event.payload.logtoSub ?? "");
    const productCode = String(event.payload.productCode ?? "");
    if (!logtoSub || !productCode) throw new Error("Invalid trial notify payload");

    const pref = await this.prefs.getOrDefault(logtoSub);
    const title =
      event.eventType === "trial.expiring"
        ? `Your ${productCode} trial ends in 3 days`
        : `Your ${productCode} trial has ended`;
    const body =
      event.eventType === "trial.expiring"
        ? `Upgrade to Pro to keep premium features after ${String(event.payload.endsAt ?? "")}.`
        : `Upgrade to Pro to restore premium features for ${productCode}.`;

    const message: NotifyMessage = {
      eventType: event.eventType,
      logtoSub,
      productCode,
      title,
      body,
      emailAddress: pref.emailAddress,
      pushTokens: pref.pushTokens,
      metadata: event.payload,
    };

    const errors: string[] = [];
    for (const adapter of this.adapters) {
      const enabled =
        (adapter.channel === "email" && pref.emailEnabled) ||
        (adapter.channel === "in_app" && pref.inAppEnabled) ||
        (adapter.channel === "push" && pref.pushEnabled);
      if (!enabled) continue;
      if (!adapter.isConfigured()) {
        if (adapter.channel === "in_app") continue;
        continue;
      }
      try {
        await adapter.send(message);
      } catch (err) {
        errors.push(`${adapter.channel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length && errors.length === this.adapters.filter((a) => a.isConfigured()).length) {
      throw new Error(errors.join("; "));
    }
    if (errors.length) {
      this.logger.warn(`Partial notify delivery for ${event.id}: ${errors.join("; ")}`);
    }
  }
}

/** pg driver returns snake_case column names for raw RETURNING *. */
function normalizeClaimRow(row: Record<string, unknown>): Partial<OutboxEventEntity> {
  return {
    id: String(row.id),
    eventType: String(row.event_type ?? row.eventType),
    dedupeKey: String(row.dedupe_key ?? row.dedupeKey),
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: (row.status as OutboxEventEntity["status"]) ?? "processing",
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? 8),
    nextAttemptAt: (row.next_attempt_at ?? row.nextAttemptAt ?? null) as Date | null,
    scheduledFor: (row.scheduled_for ?? row.scheduledFor ?? null) as Date | null,
    lastError: (row.last_error ?? row.lastError ?? null) as string | null,
    deadLetteredAt: (row.dead_lettered_at ?? row.deadLetteredAt ?? null) as Date | null,
    lockedUntil: (row.locked_until ?? row.lockedUntil ?? null) as Date | null,
    lockedBy: (row.locked_by ?? row.lockedBy ?? null) as string | null,
    createdAt: (row.created_at ?? row.createdAt) as Date,
    updatedAt: (row.updated_at ?? row.updatedAt) as Date,
  };
}
