import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, type Repository } from "typeorm";
import type { BillingMarket } from "../../common/catalog-pricing";
import { EntitlementException } from "../../common/errors";
import type { GeoContext } from "../../common/payment-geo";
import { sha256Hex } from "../../common/crypto";
import { redactPaymentSecrets } from "../../common/payment-crypto";
import {
  isDevManualProvider,
  isPaidLikeOrderStatus,
  isRefundableOrderStatus,
  isUnpaidOrderStatus,
} from "../../common/payment-providers";
import {
  hintForbiddenInDecision,
  pickProvider,
  selectAvailableProviders,
  type RoutableProviderConfig,
} from "../../common/payment-routing";
import type { EntitlementConfig } from "../../config/entitlement.config";
import { OrderEntity } from "../../database/entities/order.entity";
import { PaymentAttemptEntity } from "../../database/entities/payment-attempt.entity";
import { PaymentProviderConfigEntity } from "../../database/entities/payment-provider-config.entity";
import { RefundEntity } from "../../database/entities/refund.entity";
import { AuditService } from "../audit/audit.service";
import { fulfillPaidOrderTx, revokeOrderEntitlements } from "../orders/order-fulfillment";
import { BillingProfileService } from "./billing-profile.service";
import { PaymentConfigService } from "./payment-config.service";
import { PaymentGeoService } from "./payment-geo.service";

@Injectable()
export class PaymentsService {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OrderEntity) private readonly orders: Repository<OrderEntity>,
    @InjectRepository(PaymentAttemptEntity)
    private readonly attempts: Repository<PaymentAttemptEntity>,
    @InjectRepository(RefundEntity) private readonly refunds: Repository<RefundEntity>,
    private readonly paymentConfigs: PaymentConfigService,
    private readonly billing: BillingProfileService,
    private readonly geo: PaymentGeoService,
    private readonly audit: AuditService,
  ) {}

  private conf(): EntitlementConfig {
    return this.config.getOrThrow<EntitlementConfig>("entitlement");
  }

  async listMethods(input: {
    subjectKind: "USER" | "ORGANIZATION" | "DEPLOYMENT";
    subjectId: string;
    currency?: string;
    geo: GeoContext;
  }) {
    const profile = await this.billing.get(input.subjectKind, input.subjectId);
    const market = this.geo.marketFor(input.geo.country);
    const decision = await this.route({
      market,
      currency: input.currency ?? "USD",
      ipCountry: input.geo.country,
      billingCountry: profile?.country ?? null,
    });
    return {
      market,
      ipCountry: input.geo.country,
      billingCountry: profile?.country ?? null,
      geoSource: input.geo.source,
      items: decision.allowed.map((item) => ({
        configId: item.id,
        providerId: item.providerId,
        priority: item.priority,
        currencies: item.currencies,
      })),
    };
  }

  async startCheckout(input: {
    orderId: string;
    actor: string;
    requestId?: string;
    expectedSubjectId?: string;
    allowAnyOrder?: boolean;
    geo: GeoContext;
    providerHint?: string;
  }) {
    const order = await this.orders.findOne({ where: { id: input.orderId } });
    if (!order) throw new EntitlementException("NOT_FOUND", `Order ${input.orderId} not found`);
    if (
      !input.allowAnyOrder &&
      input.expectedSubjectId &&
      order.subjectId !== input.expectedSubjectId
    ) {
      throw new EntitlementException("FORBIDDEN", "Cannot pay an order owned by another subject");
    }
    if (isPaidLikeOrderStatus(order.status)) {
      return { order, payment: null, alreadyPaid: true, attempt: null };
    }
    if (!isUnpaidOrderStatus(order.status)) {
      throw new EntitlementException(
        "CONFLICT",
        `Order ${order.id} cannot be paid in status ${order.status}`,
      );
    }

    const profile = await this.billing.get(order.subjectKind, order.subjectId);
    const offeringMarket =
      typeof order.metadata?.market === "string" &&
      (order.metadata.market === "CN" || order.metadata.market === "GLOBAL")
        ? (order.metadata.market as BillingMarket)
        : this.geo.marketFor(input.geo.country);
    const hint = input.providerHint ?? order.paymentProvider;
    const decision = await this.route({
      market: offeringMarket,
      currency: order.currency,
      ipCountry: input.geo.country,
      billingCountry: profile?.country ?? null,
    });
    if (hint && hintForbiddenInDecision(decision, hint)) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_FORBIDDEN_MARKET",
        `Provider ${hint} is not allowed for this market or billing country`,
      );
    }
    const picked = pickProvider({ allowed: decision.allowed, hint });
    if (!picked.config) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "No operationally enabled payment provider for this market and currency",
      );
    }

    const configRow = await this.requireConfigRow(picked.config.id);
    const adapter = this.paymentConfigs.adapterFor(configRow.providerId);
    const providerConfig = this.paymentConfigs.decryptForAdapter(configRow);

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(OrderEntity, {
        where: { id: order.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!locked) throw new EntitlementException("NOT_FOUND", `Order ${order.id} not found`);
      if (isPaidLikeOrderStatus(locked.status)) {
        return { order: locked, payment: null, alreadyPaid: true, attempt: null };
      }
      const open = await manager.find(PaymentAttemptEntity, {
        where: { orderId: locked.id, status: In(["created", "pending"]) },
      });
      for (const previous of open) {
        previous.status = "canceled";
        await manager.save(previous);
      }
      const attempt = await manager.save(
        manager.create(PaymentAttemptEntity, {
          orderId: locked.id,
          configId: configRow.id,
          provider: configRow.providerId,
          status: "created",
          amountCents: locked.amountCents,
          currency: locked.currency,
          merchantId: configRow.merchantId,
          metadata: {
            geoCountry: input.geo.country,
            billingCountry: profile?.country ?? null,
            geoSource: input.geo.source,
          },
        }),
      );
      const session = await adapter.createCheckout({
        orderId: locked.id,
        attemptId: attempt.id,
        amountCents: locked.amountCents,
        currency: locked.currency,
        returnUrl: locked.returnUrl,
        metadata: locked.metadata,
        config: providerConfig,
      });
      attempt.providerRef = session.providerRef;
      attempt.checkoutUrl = session.checkoutUrl ?? null;
      attempt.qrPayload = session.qrPayload ?? null;
      attempt.action = session.action ?? null;
      attempt.status = session.status === "failed" ? "failed" : "pending";
      await manager.save(attempt);

      locked.paymentProvider = configRow.providerId;
      locked.paymentConfigId = configRow.id;
      locked.providerRef = session.providerRef;
      locked.status = attempt.status === "failed" ? "failed" : "pending_payment";
      locked.metadata = {
        ...locked.metadata,
        geoCountry: input.geo.country,
        billingCountry: profile?.country ?? null,
        geoSource: input.geo.source,
      };
      await manager.save(locked);

      await this.audit.record({
        actor: input.actor,
        action: "order.checkout",
        resourceType: "order",
        resourceId: locked.id,
        requestId: input.requestId,
        payload: redactPaymentSecrets({
          provider: configRow.providerId,
          configId: configRow.id,
          attemptId: attempt.id,
          checkoutUrl: Boolean(session.checkoutUrl),
        }),
      });

      return {
        order: locked,
        alreadyPaid: false,
        attempt,
        payment: {
          provider: session.provider,
          providerRef: session.providerRef,
          status: session.status,
          checkoutUrl: session.checkoutUrl ?? null,
          qrPayload: session.qrPayload ?? null,
          action: session.action ?? null,
        },
      };
    });
  }

  async completeCheckout(input: {
    orderId: string;
    actor: string;
    requestId?: string;
    expectedSubjectId?: string;
    allowAnyOrder?: boolean;
    buyerProof?: {
      paymentSignature?: string | null;
      paymentPayload?: Record<string, unknown> | null;
    } | null;
  }) {
    const order = await this.orders.findOne({ where: { id: input.orderId } });
    if (!order) throw new EntitlementException("NOT_FOUND", `Order ${input.orderId} not found`);
    if (
      !input.allowAnyOrder &&
      input.expectedSubjectId &&
      order.subjectId !== input.expectedSubjectId
    ) {
      throw new EntitlementException(
        "FORBIDDEN",
        "Cannot complete an order owned by another subject",
      );
    }
    if (isPaidLikeOrderStatus(order.status)) {
      return { order, alreadyPaid: true, attempt: null, query: null };
    }
    const attempt = await this.attempts.findOne({
      where: { orderId: order.id, status: In(["created", "pending"]) },
      order: { createdAt: "DESC" },
    });
    if (!attempt?.configId || !attempt.providerRef) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "No pending payment attempt to complete",
      );
    }
    const row = await this.paymentConfigs.loadEnabled(attempt.configId);
    if (!row) {
      throw new EntitlementException("NOT_FOUND", "Payment provider config is not available");
    }
    const adapter = this.paymentConfigs.adapterFor(row.providerId);
    const config = this.paymentConfigs.decryptForAdapter(row);
    const query = adapter.completeCheckout
      ? await adapter.completeCheckout({
          orderId: order.id,
          attemptId: attempt.id,
          providerRef: attempt.providerRef,
          amountCents: order.amountCents,
          currency: order.currency,
          config,
          action: attempt.action,
          buyerProof: input.buyerProof
            ? {
                paymentSignature: input.buyerProof.paymentSignature,
                paymentPayload: input.buyerProof.paymentPayload,
              }
            : null,
        })
      : await adapter.queryPayment(attempt.providerRef, config);
    if (query.status !== "succeeded") {
      return { order, alreadyPaid: false, attempt, query, fulfilled: false };
    }
    this.assertSnapshotMatch(order, attempt, {
      amountCents: query.amountCents,
      currency: query.currency,
      merchantId: query.merchantId ?? row.merchantId,
    });
    await this.dataSource.transaction(async (manager) => {
      attempt.status = "succeeded";
      attempt.providerRef = query.providerRef || attempt.providerRef;
      if (query.settlementProof) {
        attempt.metadata = { ...attempt.metadata, settlementProof: query.settlementProof };
      }
      await manager.save(attempt);
      await fulfillPaidOrderTx(manager, order.id, attempt.providerRef ?? query.providerRef);
    });
    await this.audit.record({
      actor: input.actor,
      action: "order.complete",
      resourceType: "order",
      resourceId: order.id,
      requestId: input.requestId,
      payload: redactPaymentSecrets({
        provider: attempt.provider,
        attemptId: attempt.id,
        providerRef: query.providerRef,
      }),
    });
    return { order, alreadyPaid: false, attempt, query, fulfilled: true };
  }

  async confirmManual(input: {
    orderId: string;
    actor: string;
    reason: string;
    ticket: string;
    requestId?: string;
  }) {
    if (!input.reason?.trim() || !input.ticket?.trim()) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "Manual confirmation requires actor reason and ticket",
      );
    }
    const order = await this.orders.findOne({ where: { id: input.orderId } });
    if (!order) throw new EntitlementException("NOT_FOUND", `Order ${input.orderId} not found`);
    if (!isDevManualProvider(order.paymentProvider)) {
      throw new EntitlementException(
        "PAYMENT_REFUND_UNSUPPORTED",
        "Live providers cannot be confirmed manually; use webhook or reconciliation",
      );
    }
    const attempt =
      (await this.attempts.findOne({
        where: { orderId: order.id, status: In(["created", "pending"]) },
        order: { createdAt: "DESC" },
      })) ??
      (await this.attempts.findOne({
        where: { orderId: order.id },
        order: { createdAt: "DESC" },
      }));
    if (!attempt) {
      throw new EntitlementException("NOT_FOUND", "No payment attempt to confirm");
    }
    await this.dataSource.transaction(async (manager) => {
      attempt.status = "succeeded";
      await manager.save(attempt);
      await fulfillPaidOrderTx(manager, order.id, attempt.providerRef ?? `manual_${attempt.id}`);
    });
    Object.assign(order, { status: "fulfilled", providerRef: attempt.providerRef });
    await this.audit.record({
      actor: input.actor,
      action: "order.manual_confirm",
      resourceType: "order",
      resourceId: order.id,
      requestId: input.requestId,
      reason: input.reason,
      payload: { ticket: input.ticket, attemptId: attempt.id, provider: order.paymentProvider },
    });
    return { order, attempt, ticket: input.ticket };
  }

  async reconcileAttempt(attemptId: string, opts: { actor: string; requestId?: string }) {
    const attempt = await this.attempts.findOne({ where: { id: attemptId } });
    if (!attempt) throw new EntitlementException("NOT_FOUND", `Attempt ${attemptId} not found`);
    if (attempt.status === "succeeded") {
      return {
        attempt,
        order: await this.orders.findOne({ where: { id: attempt.orderId } }),
        skipped: true,
      };
    }
    if (!attempt.configId || !attempt.providerRef) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Attempt has no provider reference",
      );
    }
    const row = await this.paymentConfigs.loadEnabled(attempt.configId);
    if (!row)
      throw new EntitlementException("NOT_FOUND", "Payment provider config is not available");
    const adapter = this.paymentConfigs.adapterFor(row.providerId);
    const query = await adapter.queryPayment(
      attempt.providerRef,
      this.paymentConfigs.decryptForAdapter(row),
    );
    if (query.status !== "succeeded") {
      if (query.status === "failed" || query.status === "canceled" || query.status === "expired") {
        attempt.status = query.status === "expired" ? "expired" : "failed";
        await this.attempts.save(attempt);
      }
      await this.audit.record({
        actor: opts.actor,
        action: "payment.reconcile",
        resourceType: "payment_attempt",
        resourceId: attempt.id,
        requestId: opts.requestId,
        payload: { status: query.status },
      });
      return { attempt, query, fulfilled: false };
    }
    const order = await this.orders.findOne({ where: { id: attempt.orderId } });
    if (!order) throw new EntitlementException("NOT_FOUND", "Order not found");
    this.assertSnapshotMatch(order, attempt, {
      amountCents: query.amountCents,
      currency: query.currency,
      merchantId: query.merchantId ?? row.merchantId,
    });
    await this.dataSource.transaction(async (manager) => {
      attempt.status = "succeeded";
      await manager.save(attempt);
      await fulfillPaidOrderTx(manager, order.id, attempt.providerRef ?? query.providerRef);
    });
    await this.audit.record({
      actor: opts.actor,
      action: "payment.reconcile",
      resourceType: "payment_attempt",
      resourceId: attempt.id,
      requestId: opts.requestId,
      payload: { status: "succeeded", orderId: order.id },
    });
    return { attempt, query, fulfilled: true };
  }

  async reconcilePending(opts: { actor: string; requestId?: string }) {
    const minutes = this.conf().paymentReconcilePendingMinutes;
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    const pending = await this.attempts.find({
      where: { status: "pending" },
      order: { createdAt: "ASC" },
      take: 50,
    });
    const due = pending.filter((row) => row.createdAt.getTime() <= cutoff.getTime());
    const results = [];
    for (const attempt of due) {
      results.push(await this.reconcileAttempt(attempt.id, opts));
    }
    return { scanned: pending.length, due: due.length, results };
  }

  async refundOrder(input: {
    orderId: string;
    amountCents: number;
    idempotencyKey: string;
    actor: string;
    reason: string;
    ticket?: string;
    requestId?: string;
  }) {
    if (!input.idempotencyKey?.trim()) {
      throw new EntitlementException("VALIDATION_ERROR", "refundIdempotencyKey is required");
    }
    if (!input.reason?.trim()) {
      throw new EntitlementException("VALIDATION_ERROR", "Refund reason is required");
    }
    const existing = await this.refunds.findOne({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { refund: existing, idempotent: true };

    const order = await this.orders.findOne({ where: { id: input.orderId } });
    if (!order) throw new EntitlementException("NOT_FOUND", `Order ${input.orderId} not found`);
    if (!isRefundableOrderStatus(order.status) && order.status !== "refund_pending") {
      throw new EntitlementException(
        "PAYMENT_REFUND_UNSUPPORTED",
        `Order ${order.id} cannot be refunded in status ${order.status}`,
      );
    }
    const succeeded = await this.refunds.find({
      where: { orderId: order.id, status: "succeeded" },
    });
    const already = succeeded.reduce((sum, row) => sum + row.amountCents, 0);
    if (input.amountCents <= 0 || already + input.amountCents > order.amountCents) {
      throw new EntitlementException(
        "PAYMENT_REFUND_UNSUPPORTED",
        "Refund amount must be positive and not exceed the net paid amount",
      );
    }
    const attempt = await this.attempts.findOne({
      where: { orderId: order.id, status: "succeeded" },
      order: { createdAt: "DESC" },
    });
    if (!attempt?.configId || !attempt.providerRef) {
      throw new EntitlementException(
        "PAYMENT_REFUND_UNSUPPORTED",
        "No succeeded payment attempt to refund",
      );
    }
    const configRow = await this.requireConfigRow(attempt.configId);
    if (!configRow.capabilities.refund) {
      throw new EntitlementException(
        "PAYMENT_REFUND_UNSUPPORTED",
        "Provider config does not allow refunds",
      );
    }
    if (input.amountCents < order.amountCents && !configRow.capabilities.partialRefund) {
      throw new EntitlementException(
        "PAYMENT_REFUND_UNSUPPORTED",
        "Provider does not allow partial refunds",
      );
    }
    const adapter = this.paymentConfigs.adapterFor(configRow.providerId);
    const providerConfig = this.paymentConfigs.decryptForAdapter(configRow);

    const refund = await this.refunds.save(
      this.refunds.create({
        orderId: order.id,
        attemptId: attempt.id,
        idempotencyKey: input.idempotencyKey,
        amountCents: input.amountCents,
        currency: order.currency,
        status: "pending",
        actor: input.actor,
        reason: input.reason,
        ticket: input.ticket ?? null,
      }),
    );
    order.status = "refund_pending";
    await this.orders.save(order);

    const result = await adapter.refund(
      {
        orderId: order.id,
        attemptId: attempt.id,
        providerRef: attempt.providerRef,
        amountCents: input.amountCents,
        currency: order.currency,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      },
      providerConfig,
    );
    refund.providerRef = result.providerRef;
    refund.status = result.status;
    await this.refunds.save(refund);

    if (result.status === "succeeded") {
      const net = already + input.amountCents;
      await this.dataSource.transaction(async (manager) => {
        const locked = await manager.findOne(OrderEntity, {
          where: { id: order.id },
          lock: { mode: "pessimistic_write" },
        });
        if (!locked) return;
        if (net >= locked.amountCents) {
          locked.status = "refunded";
          await revokeOrderEntitlements(manager, locked, new Date());
        } else {
          locked.status = "partially_refunded";
        }
        await manager.save(locked);
        Object.assign(order, locked);
      });
    } else if (result.status === "failed") {
      order.status = already > 0 ? "partially_refunded" : "fulfilled";
      await this.orders.save(order);
    }

    await this.audit.record({
      actor: input.actor,
      action: "payment.refund",
      resourceType: "refund",
      resourceId: refund.id,
      requestId: input.requestId,
      reason: input.reason,
      payload: redactPaymentSecrets({
        orderId: order.id,
        amountCents: input.amountCents,
        status: refund.status,
        ticket: input.ticket ?? null,
      }),
    });
    return { refund, order, idempotent: false };
  }

  async listOrdersAdmin(filter: {
    status?: string;
    subjectId?: string;
    productCode?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { page, pageSize, skip } = pageWindow(filter.page, filter.pageSize);
    const qb = this.orders.createQueryBuilder("o").orderBy("o.createdAt", "DESC");
    if (filter.status) qb.andWhere("o.status = :status", { status: filter.status });
    if (filter.subjectId) qb.andWhere("o.subjectId = :subjectId", { subjectId: filter.subjectId });
    if (filter.productCode) {
      qb.andWhere("o.productCode = :productCode", { productCode: filter.productCode });
    }
    const total = await qb.getCount();
    const rows = await qb.skip(skip).take(pageSize).getMany();
    return { items: rows.map(adminJson), page, pageSize, total };
  }

  async listAttemptsAdmin(filter: {
    status?: string;
    orderId?: string;
    provider?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { page, pageSize, skip } = pageWindow(filter.page, filter.pageSize);
    const qb = this.attempts.createQueryBuilder("a").orderBy("a.createdAt", "DESC");
    if (filter.status) qb.andWhere("a.status = :status", { status: filter.status });
    if (filter.orderId) qb.andWhere("a.orderId = :orderId", { orderId: filter.orderId });
    if (filter.provider) qb.andWhere("a.provider = :provider", { provider: filter.provider });
    const total = await qb.getCount();
    const rows = await qb.skip(skip).take(pageSize).getMany();
    return { items: rows.map(adminJson), page, pageSize, total };
  }

  async listRefundsAdmin(filter: {
    status?: string;
    orderId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { page, pageSize, skip } = pageWindow(filter.page, filter.pageSize);
    const qb = this.refunds.createQueryBuilder("r").orderBy("r.createdAt", "DESC");
    if (filter.status) qb.andWhere("r.status = :status", { status: filter.status });
    if (filter.orderId) qb.andWhere("r.orderId = :orderId", { orderId: filter.orderId });
    const total = await qb.getCount();
    const rows = await qb.skip(skip).take(pageSize).getMany();
    return { items: rows.map(adminJson), page, pageSize, total };
  }

  async getAttemptAdmin(attemptId: string) {
    const attempt = await this.attempts.findOne({ where: { id: attemptId } });
    if (!attempt) throw new EntitlementException("NOT_FOUND", `Attempt ${attemptId} not found`);
    return adminJson(attempt);
  }

  async getOrderAdmin(orderId: string) {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new EntitlementException("NOT_FOUND", `Order ${orderId} not found`);
    const attempts = await this.attempts.find({ where: { orderId }, order: { createdAt: "DESC" } });
    const refunds = await this.refunds.find({ where: { orderId }, order: { createdAt: "DESC" } });
    return {
      order: adminJson(order),
      attempts: attempts.map(adminJson),
      refunds: refunds.map(adminJson),
    };
  }

  assertSnapshotMatch(
    order: OrderEntity,
    attempt: PaymentAttemptEntity,
    observed: { amountCents: number; currency: string; merchantId?: string | null },
  ): void {
    if (
      observed.amountCents !== order.amountCents ||
      observed.currency.toUpperCase() !== order.currency.toUpperCase() ||
      observed.amountCents !== attempt.amountCents
    ) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "Provider amount or currency does not match the order snapshot",
      );
    }
    const expectedMerchant = attempt.merchantId ?? order.paymentConfigId;
    if (attempt.merchantId && observed.merchantId && observed.merchantId !== attempt.merchantId) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "Provider merchant id does not match the order snapshot",
        { details: { expectedMerchant } },
      );
    }
  }

  rawBodySha256(raw: Uint8Array): string {
    return sha256Hex(Buffer.from(raw));
  }

  private async route(input: {
    market: BillingMarket;
    currency: string;
    ipCountry: string | null;
    billingCountry: string | null;
  }) {
    const rows = await this.operationalConfigs();
    return selectAvailableProviders({
      configs: rows,
      market: input.market,
      currency: input.currency,
      ipCountry: input.ipCountry,
      billingCountry: input.billingCountry,
      marketPolicy: this.conf().paymentMarketPolicy,
    });
  }

  private async operationalConfigs(): Promise<RoutableProviderConfig[]> {
    const rows = await this.paymentConfigs.listEnabledRows();
    if (rows.length === 0 && this.conf().nodeEnv !== "production") {
      return [];
    }
    const out: RoutableProviderConfig[] = [];
    for (const row of rows) {
      const adapter = this.paymentConfigs.adapterFor(row.providerId);
      let healthy = false;
      try {
        const health = await adapter.healthCheck(this.paymentConfigs.decryptForAdapter(row));
        healthy = health.ok;
      } catch {
        healthy = false;
      }
      out.push({
        id: row.id,
        providerId: row.providerId,
        enabled: row.enabled,
        status: row.status,
        marketScopes: row.marketScopes,
        currencies: row.currencies,
        priority: row.priority,
        healthy,
      });
    }
    return out;
  }

  private async requireConfigRow(id: string): Promise<PaymentProviderConfigEntity> {
    const row = await this.paymentConfigs.loadEnabled(id);
    if (!row) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Payment provider config is not available",
      );
    }
    return row;
  }
}

function pageWindow(pageRaw?: number, pageSizeRaw?: number) {
  const page = Math.max(1, Number(pageRaw) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function adminJson<T>(row: T): T {
  return redactPaymentSecrets(JSON.parse(JSON.stringify(row))) as T;
}
