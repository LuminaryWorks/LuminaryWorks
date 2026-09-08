import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, QueryFailedError, type Repository } from "typeorm";
import { EntitlementException } from "../../common/errors";
import { redactPaymentSecrets } from "../../common/payment-crypto";
import { PaymentAttemptEntity } from "../../database/entities/payment-attempt.entity";
import { OrderEntity } from "../../database/entities/order.entity";
import { ProviderWebhookEventEntity } from "../../database/entities/provider-webhook-event.entity";
import { AuditService } from "../audit/audit.service";
import { fulfillPaidOrderTx } from "../orders/order-fulfillment";
import { PaymentConfigService } from "./payment-config.service";
import { PaymentsService } from "./payments.service";
import type { PaymentAdapter, ProviderConfig, VerifiedWebhook } from "./payment-adapter";

const NOT_FOUND_MESSAGE = "Not found";

@Injectable()
export class PaymentWebhookService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ProviderWebhookEventEntity)
    private readonly events: Repository<ProviderWebhookEventEntity>,
    @InjectRepository(PaymentAttemptEntity)
    private readonly attempts: Repository<PaymentAttemptEntity>,
    @InjectRepository(OrderEntity) private readonly orders: Repository<OrderEntity>,
    private readonly paymentConfigs: PaymentConfigService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  async handlePublic(input: {
    provider: string;
    configId: string;
    rawBody: Uint8Array;
    headers: Record<string, string>;
  }): Promise<{ status: number; body: unknown }> {
    const row = await this.paymentConfigs.loadEnabled(input.configId);
    if (!row || row.providerId !== input.provider) {
      throw new EntitlementException("NOT_FOUND", NOT_FOUND_MESSAGE);
    }

    const adapter = this.paymentConfigs.adapterFor(row.providerId);
    const candidates = this.paymentConfigs.decryptCurrentAndPrevious(row);
    const verified = await this.verifyWithCandidates(
      adapter,
      input.rawBody,
      input.headers,
      candidates,
    );
    if (!verified.eventId) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Webhook event id is required");
    }

    const rawHash = this.payments.rawBodySha256(input.rawBody);
    const ack = verified.ack ?? { status: 200, body: { received: true } };

    try {
      await this.events.save(
        this.events.create({
          provider: row.providerId,
          configId: row.id,
          eventId: verified.eventId,
          rawBodySha256: rawHash,
          payload: redactPaymentSecrets(verified.payload),
          status: "received",
          orderId: verified.orderId || null,
          attemptId: verified.attemptId || null,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        return ack;
      }
      throw err;
    }

    try {
      await this.fulfillVerified(row.id, verified);
      await this.events.update(
        { provider: row.providerId, configId: row.id, eventId: verified.eventId },
        { status: "processed" },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "webhook processing failed";
      await this.events.update(
        { provider: row.providerId, configId: row.id, eventId: verified.eventId },
        { status: "failed", error: message },
      );
      throw err;
    }

    return ack;
  }

  private async verifyWithCandidates(
    adapter: PaymentAdapter,
    rawBody: Uint8Array,
    headers: Record<string, string>,
    candidates: ProviderConfig[],
  ): Promise<VerifiedWebhook> {
    let last: EntitlementException | null = null;
    for (const config of candidates) {
      try {
        return await adapter.verifyWebhook(rawBody, headers, config);
      } catch (err) {
        if (err instanceof EntitlementException && err.code === "PAYMENT_WEBHOOK_INVALID") {
          last = err;
          continue;
        }
        throw err;
      }
    }
    throw (
      last ?? new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Webhook verification failed")
    );
  }

  private async fulfillVerified(configId: string, verified: VerifiedWebhook): Promise<void> {
    if (verified.status === "ignored" || verified.status === "pending") return;
    const order = await this.orders.findOne({ where: { id: verified.orderId } });
    if (!order) {
      throw new EntitlementException("NOT_FOUND", `Order ${verified.orderId} not found`);
    }
    const attempt = await this.findAttempt(order.id, verified);
    if (!attempt) {
      throw new EntitlementException("NOT_FOUND", "Payment attempt not found for webhook");
    }

    let observed = verified;
    if (verified.requiresQuery) {
      const row = await this.paymentConfigs.loadEnabled(configId);
      if (!row) throw new EntitlementException("NOT_FOUND", NOT_FOUND_MESSAGE);
      const query = await this.paymentConfigs
        .adapterFor(row.providerId)
        .queryPayment(verified.providerRef, this.paymentConfigs.decryptForAdapter(row));
      if (query.status !== "succeeded") return;
      observed = {
        ...verified,
        status: "succeeded",
        amountCents: query.amountCents,
        currency: query.currency,
        merchantId: query.merchantId ?? verified.merchantId,
      };
    }

    if (observed.status === "failed") {
      await this.dataSource.transaction(async (manager) => {
        const lockedAttempt = await manager.findOne(PaymentAttemptEntity, {
          where: { id: attempt.id },
          lock: { mode: "pessimistic_write" },
        });
        const lockedOrder = await manager.findOne(OrderEntity, {
          where: { id: order.id },
          lock: { mode: "pessimistic_write" },
        });
        if (lockedAttempt) {
          lockedAttempt.status = "failed";
          await manager.save(lockedAttempt);
        }
        if (lockedOrder && lockedOrder.status === "pending_payment") {
          lockedOrder.status = "failed";
          await manager.save(lockedOrder);
        }
      });
      return;
    }

    this.payments.assertSnapshotMatch(order, attempt, {
      amountCents: observed.amountCents,
      currency: observed.currency,
      merchantId: observed.merchantId ?? attempt.merchantId,
    });

    await this.dataSource.transaction(async (manager) => {
      const lockedAttempt = await manager.findOne(PaymentAttemptEntity, {
        where: { id: attempt.id },
        lock: { mode: "pessimistic_write" },
      });
      if (lockedAttempt) {
        lockedAttempt.status = "succeeded";
        lockedAttempt.providerRef = observed.providerRef;
        await manager.save(lockedAttempt);
      }
      await fulfillPaidOrderTx(manager, order.id, observed.providerRef);
    });
    await this.audit.record({
      actor: "payment-webhook",
      action: "order.paid",
      resourceType: "order",
      resourceId: order.id,
      payload: redactPaymentSecrets({
        provider: attempt.provider,
        attemptId: attempt.id,
        eventId: verified.eventId,
      }),
    });
  }

  private async findAttempt(
    orderId: string,
    verified: VerifiedWebhook,
  ): Promise<PaymentAttemptEntity | null> {
    if (verified.attemptId) {
      return this.attempts.findOne({ where: { id: verified.attemptId, orderId } });
    }
    if (verified.providerRef) {
      const byRef = await this.attempts.findOne({
        where: { orderId, providerRef: verified.providerRef },
      });
      if (byRef) return byRef;
    }
    return this.attempts.findOne({
      where: { orderId, status: "pending" },
      order: { createdAt: "DESC" },
    });
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof QueryFailedError) {
    const driver = err.driverError as { code?: string } | undefined;
    return driver?.code === "23505";
  }
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
