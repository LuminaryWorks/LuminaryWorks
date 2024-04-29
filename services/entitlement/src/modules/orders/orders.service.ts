import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, type Repository } from "typeorm";
import type { PlanCode, SubjectKind } from "../../common/constants";
import { EntitlementException } from "../../common/errors";
import { assertTrialPlanAllowed } from "../../common/trial-policy";
import { BundleEntity } from "../../database/entities/bundle.entity";
import { GrantEntity } from "../../database/entities/grant.entity";
import { OrderEntity } from "../../database/entities/order.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { WebhookEventEntity } from "../../database/entities/webhook-event.entity";
import { AuditService } from "../audit/audit.service";
import type { PaymentAdapter } from "../payments/payment-adapter";
import { PAYMENT_ADAPTERS } from "../payments/payment-adapter";

@Injectable()
export class OrdersService {
  private readonly adapters: Map<string, PaymentAdapter>;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(BundleEntity)
    private readonly bundles: Repository<BundleEntity>,
    @InjectRepository(WebhookEventEntity)
    private readonly webhooks: Repository<WebhookEventEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @Inject(PAYMENT_ADAPTERS) adapters: PaymentAdapter[],
    private readonly audit: AuditService,
  ) {
    this.adapters = new Map(adapters.map((a) => [a.provider, a]));
  }

  async createOrder(input: {
    subjectKind: SubjectKind;
    subjectId: string;
    productCode?: string;
    planCode?: PlanCode;
    bundleSku?: string;
    amountCents?: number;
    currency?: string;
    paymentProvider?: string;
    metadata?: Record<string, unknown>;
    actor: string;
    requestId?: string;
  }): Promise<OrderEntity> {
    if (!input.bundleSku && (!input.productCode || !input.planCode)) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "Provide bundleSku or productCode+planCode",
      );
    }
    if (input.bundleSku) {
      const bundle = await this.bundles.findOne({
        where: { sku: input.bundleSku, active: true },
        relations: { items: true },
      });
      if (!bundle) {
        throw new EntitlementException("NOT_FOUND", `Unknown bundle ${input.bundleSku}`);
      }
      await this.assertDeclaredBundleProducts(bundle.items.map((i) => i.productCode));
      for (const item of bundle.items) {
        await assertTrialPlanAllowed(this.products, item.productCode, item.planCode);
      }
    } else if (input.productCode) {
      await this.assertDeclaredBundleProducts([input.productCode]);
      await assertTrialPlanAllowed(this.products, input.productCode, input.planCode);
    }
    const provider = input.paymentProvider ?? "mock";
    if (!this.adapters.has(provider)) {
      throw new EntitlementException("VALIDATION_ERROR", `Unknown payment provider ${provider}`);
    }
    const order = await this.orders.save(
      this.orders.create({
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        productCode: input.productCode ?? null,
        planCode: input.planCode ?? null,
        bundleSku: input.bundleSku ?? null,
        status: "pending",
        amountCents: input.amountCents ?? 0,
        currency: input.currency ?? "USD",
        paymentProvider: provider,
        metadata: input.metadata ?? {},
      }),
    );
    await this.audit.record({
      actor: input.actor,
      action: "order.create",
      resourceType: "order",
      resourceId: order.id,
      requestId: input.requestId,
      payload: { provider, productCode: order.productCode, planCode: order.planCode },
    });
    return order;
  }

  async payOrder(
    orderId: string,
    opts: {
      actor: string;
      requestId?: string;
      payload?: Record<string, unknown>;
      expectedSubjectId?: string;
      allowAnyOrder?: boolean;
    },
  ) {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new EntitlementException("NOT_FOUND", `Order ${orderId} not found`);
    if (
      !opts.allowAnyOrder &&
      opts.expectedSubjectId &&
      order.subjectId !== opts.expectedSubjectId
    ) {
      throw new EntitlementException("FORBIDDEN", "Cannot pay an order owned by another subject");
    }
    if (order.status === "paid") return { order, payment: null, alreadyPaid: true };

    const adapter = this.adapters.get(order.paymentProvider);
    if (!adapter) {
      throw new EntitlementException("VALIDATION_ERROR", `No adapter for ${order.paymentProvider}`);
    }

    const payment = await adapter.createPayment({
      orderId: order.id,
      amountCents: order.amountCents,
      currency: order.currency,
      metadata: order.metadata,
    });

    if (payment.status === "failed") {
      order.status = "failed";
      order.providerRef = payment.providerRef;
      await this.orders.save(order);
      return { order, payment, alreadyPaid: false };
    }

    if (payment.status === "captured" || payment.status === "authorized") {
      await this.fulfillPaidOrder(order, payment.providerRef, opts);
      return { order, payment, alreadyPaid: false };
    }

    order.providerRef = payment.providerRef;
    await this.orders.save(order);
    return { order, payment, alreadyPaid: false };
  }

  async handlePayCallback(
    provider: string,
    payload: Record<string, unknown>,
    opts: { actor: string; requestId?: string },
  ) {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new EntitlementException("VALIDATION_ERROR", `Unknown provider ${provider}`);
    }
    const event = await this.webhooks.save(
      this.webhooks.create({
        provider,
        eventId: typeof payload.eventId === "string" ? payload.eventId : null,
        payload,
        status: "received",
      }),
    );
    const result = await adapter.handleCallback({ provider, payload });
    const order = await this.orders.findOne({ where: { id: result.orderId } });
    if (!order) {
      event.status = "ignored";
      event.error = "order not found";
      await this.webhooks.save(event);
      return { ignored: true };
    }
    if (result.status === "paid") {
      await this.fulfillPaidOrder(order, result.providerRef, opts);
      event.status = "processed";
    } else if (result.status === "failed") {
      order.status = "failed";
      await this.orders.save(order);
      event.status = "processed";
    } else {
      event.status = "ignored";
    }
    await this.webhooks.save(event);
    return { order, result };
  }

  private async fulfillPaidOrder(
    order: OrderEntity,
    providerRef: string,
    opts: { actor: string; requestId?: string },
  ) {
    await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(OrderEntity, {
        where: { id: order.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!locked || locked.status === "paid") return;
      locked.status = "paid";
      locked.providerRef = providerRef;
      await manager.save(locked);

      const startsAt = new Date();
      const items: Array<{ productCode: string; planCode: PlanCode }> = [];
      if (locked.bundleSku) {
        const bundle = await manager.findOne(BundleEntity, {
          where: { sku: locked.bundleSku },
          relations: { items: true },
        });
        for (const item of bundle?.items ?? []) {
          items.push({ productCode: item.productCode, planCode: item.planCode });
        }
      } else if (locked.productCode && locked.planCode) {
        items.push({ productCode: locked.productCode, planCode: locked.planCode });
      }

      await this.assertDeclaredBundleProducts(items.map((i) => i.productCode));
      const transactionProducts = manager.getRepository(ProductEntity);
      for (const item of items) {
        await assertTrialPlanAllowed(transactionProducts, item.productCode, item.planCode);
      }

      for (const item of items) {
        const sub = await manager.save(
          manager.create(SubscriptionEntity, {
            subjectKind: locked.subjectKind,
            subjectId: locked.subjectId,
            productCode: item.productCode,
            planCode: item.planCode,
            status: "active",
            startsAt,
            endsAt: null,
            source: "order",
            sourceRef: locked.id,
            organizationId: null,
          }),
        );
        await manager.save(
          manager.create(GrantEntity, {
            subjectKind: locked.subjectKind,
            subjectId: locked.subjectId,
            productCode: item.productCode,
            planCode: item.planCode,
            features: {},
            startsAt,
            endsAt: null,
            source: "order",
            sourceRef: sub.id,
            revoked: false,
          }),
        );

        // Cancel pending/failed Trial notifications once the user upgrades
        if (locked.subjectKind === "USER" && item.planCode !== "trial") {
          await manager
            .createQueryBuilder()
            .update(OutboxEventEntity)
            .set({ status: "canceled" })
            .where("status IN (:...st)", { st: ["pending", "failed"] })
            .andWhere("event_type IN (:...types)", {
              types: ["trial.expiring", "trial.expired"],
            })
            .andWhere("payload->>'logtoSub' = :sub", { sub: locked.subjectId })
            .andWhere("payload->>'productCode' = :productCode", {
              productCode: item.productCode,
            })
            .execute();
        }
      }
    });

    Object.assign(order, { status: "paid", providerRef });
    await this.audit.record({
      actor: opts.actor,
      action: "order.paid",
      resourceType: "order",
      resourceId: order.id,
      requestId: opts.requestId,
    });
  }

  /** Bundle / order SKUs may only reference catalog products. */
  private async assertDeclaredBundleProducts(productCodes: string[]): Promise<void> {
    const unique = [...new Set(productCodes.map((c) => c.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new EntitlementException("VALIDATION_ERROR", "Order has no declared products");
    }
    const found = await this.products.find({
      where: { code: In(unique), active: true },
    });
    const foundCodes = new Set(found.map((p) => p.code));
    const missing = unique.filter((c) => !foundCodes.has(c));
    if (missing.length > 0) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        `Bundle/order references undeclared products: ${missing.join(", ")}`,
      );
    }
  }
}
