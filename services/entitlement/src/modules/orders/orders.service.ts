import { Inject, Injectable, Optional } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, type Repository } from "typeorm";
import type { BillingInterval } from "../../common/catalog-pricing";
import type { PlanCode, SubjectKind } from "../../common/constants";
import { EntitlementException } from "../../common/errors";
import { isDevManualProvider, isPaidLikeOrderStatus } from "../../common/payment-providers";
import type { GeoContext } from "../../common/payment-geo";
import { assertTrialPlanAllowed } from "../../common/trial-policy";
import { getQuotaPack } from "../../common/voice-packs";
import { BundleEntity } from "../../database/entities/bundle.entity";
import { OrderEntity } from "../../database/entities/order.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { WebhookEventEntity } from "../../database/entities/webhook-event.entity";
import { AuditService } from "../audit/audit.service";
import { CatalogService } from "../catalog/catalog.service";
import type { PaymentAdapter } from "../payments/payment-adapter";
import { PAYMENT_ADAPTERS } from "../payments/payment-adapter";
import { PaymentsService } from "../payments/payments.service";
import { fulfillPaidOrderTx } from "./order-fulfillment";

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
    private readonly catalog: CatalogService,
    @Optional() private readonly payments: PaymentsService | null = null,
  ) {
    this.adapters = new Map(adapters.map((a) => [a.provider, a]));
  }

  async createOrder(input: {
    subjectKind: SubjectKind;
    subjectId: string;
    offeringId?: string;
    sku?: string;
    productCode?: string;
    interval?: string;
    providerHint?: string;
    returnUrl?: string;
    packSku?: string;
    bundleSku?: string;
    /** @deprecated User callers must not send this; retained for trial-policy guards. */
    planCode?: PlanCode;
    metadata?: Record<string, unknown>;
    actor: string;
    requestId?: string;
  }): Promise<OrderEntity> {
    if (input.planCode === "trial") {
      await this.assertDeclaredBundleProducts([input.productCode ?? ""]);
      await assertTrialPlanAllowed(this.products, input.productCode ?? "", input.planCode);
    }

    const pack = input.packSku ? getQuotaPack(input.packSku) : undefined;
    if (input.packSku && !pack) {
      throw new EntitlementException("NOT_FOUND", `Unknown pack SKU ${input.packSku}`);
    }
    if (pack && pack.amountCents <= 0) {
      throw new EntitlementException(
        "PAYMENT_OFFERING_INVALID",
        "Zero-price quota packs cannot be ordered",
      );
    }

    if (pack) {
      await this.assertDeclaredBundleProducts([pack.productCode]);
      const product = await this.requireProduct(pack.productCode);
      this.assertProductSellable(product);
      return this.persistOrder({
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        productCode: pack.productCode,
        planCode: null,
        bundleSku: null,
        offeringId: null,
        offeringSku: pack.sku,
        interval: null,
        catalogRevisionId: null,
        returnUrl: input.returnUrl ?? null,
        amountCents: pack.amountCents,
        currency: pack.currency,
        paymentProvider: this.resolveProvider(input.providerHint),
        metadata: {
          ...(input.metadata ?? {}),
          kind: "quota_pack",
          packSku: pack.sku,
          featureCode: pack.featureCode,
          seconds: pack.seconds,
          validDays: pack.validDays,
        },
        actor: input.actor,
        requestId: input.requestId,
      });
    }

    if (input.bundleSku && !input.offeringId && !input.sku) {
      throw new EntitlementException(
        "PAYMENT_OFFERING_INVALID",
        "Bundle orders require a published offeringId or sku",
      );
    }

    if (!input.offeringId && !input.sku) {
      throw new EntitlementException(
        "PAYMENT_OFFERING_INVALID",
        "Provide offeringId or sku; amount, currency, and plan are server-authoritative",
      );
    }

    const offering = await this.catalog.findPublishedOffering({
      offeringId: input.offeringId,
      sku: input.sku,
    });
    if (input.offeringId && input.sku && offering.sku !== input.sku) {
      throw new EntitlementException(
        "PAYMENT_OFFERING_INVALID",
        "offeringId and sku do not refer to the same published offering",
      );
    }
    if (offering.amountMinor <= 0) {
      throw new EntitlementException(
        "PAYMENT_OFFERING_INVALID",
        "Zero or negative offerings cannot be ordered",
        { details: { sku: offering.sku } },
      );
    }
    if (input.productCode && input.productCode !== offering.productCode) {
      throw new EntitlementException(
        "PAYMENT_OFFERING_INVALID",
        "productCode does not match the published offering",
        { productCode: input.productCode },
      );
    }
    if (input.interval && input.interval !== offering.interval) {
      throw new EntitlementException(
        "PAYMENT_OFFERING_INVALID",
        "interval does not match the published offering",
      );
    }
    const product = await this.requireProduct(offering.productCode);
    this.assertProductSellable(product);
    await assertTrialPlanAllowed(this.products, offering.productCode, offering.planCode);

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
        const itemProduct = await this.requireProduct(item.productCode);
        this.assertProductSellable(itemProduct);
      }
    }

    return this.persistOrder({
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      productCode: offering.productCode,
      planCode: offering.planCode,
      bundleSku: input.bundleSku ?? null,
      offeringId: offering.id,
      offeringSku: offering.sku,
      interval: offering.interval,
      catalogRevisionId: offering.revisionId,
      returnUrl: input.returnUrl ?? null,
      amountCents: offering.amountMinor,
      currency: offering.currency,
      paymentProvider: this.resolveProvider(input.providerHint),
      metadata: {
        ...(input.metadata ?? {}),
        kind: "offering",
        offeringId: offering.id,
        offeringSku: offering.sku,
        catalogRevisionId: offering.revisionId,
        interval: offering.interval,
        amountMinor: offering.amountMinor,
        market: offering.market,
      },
      actor: input.actor,
      requestId: input.requestId,
    });
  }

  async getOwnedOrder(
    orderId: string,
    opts: { expectedSubjectId?: string; allowAnyOrder?: boolean },
  ): Promise<OrderEntity> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new EntitlementException("NOT_FOUND", `Order ${orderId} not found`);
    if (
      !opts.allowAnyOrder &&
      opts.expectedSubjectId &&
      order.subjectId !== opts.expectedSubjectId
    ) {
      throw new EntitlementException("FORBIDDEN", "Cannot read an order owned by another subject");
    }
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
      geo?: GeoContext;
      providerHint?: string;
    },
  ) {
    if (this.payments && opts.geo) {
      return this.payments.startCheckout({
        orderId,
        actor: opts.actor,
        requestId: opts.requestId,
        expectedSubjectId: opts.expectedSubjectId,
        allowAnyOrder: opts.allowAnyOrder,
        geo: opts.geo,
        providerHint: opts.providerHint,
      });
    }

    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new EntitlementException("NOT_FOUND", `Order ${orderId} not found`);
    if (
      !opts.allowAnyOrder &&
      opts.expectedSubjectId &&
      order.subjectId !== opts.expectedSubjectId
    ) {
      throw new EntitlementException("FORBIDDEN", "Cannot pay an order owned by another subject");
    }
    if (isPaidLikeOrderStatus(order.status)) return { order, payment: null, alreadyPaid: true };

    const adapter = this.adapters.get(order.paymentProvider);
    if (!adapter?.createPayment) {
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
    order.status = "pending_payment";
    await this.orders.save(order);
    return { order, payment, alreadyPaid: false };
  }

  async completeOrder(
    orderId: string,
    opts: {
      actor: string;
      requestId?: string;
      expectedSubjectId?: string;
      allowAnyOrder?: boolean;
      buyerProof?: {
        paymentSignature?: string | null;
        paymentPayload?: Record<string, unknown> | null;
      } | null;
    },
  ) {
    if (!this.payments) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Payment completion requires the payments module",
      );
    }
    return this.payments.completeCheckout({
      orderId,
      actor: opts.actor,
      requestId: opts.requestId,
      expectedSubjectId: opts.expectedSubjectId,
      allowAnyOrder: opts.allowAnyOrder,
      buyerProof: opts.buyerProof,
    });
  }

  /**
   * Dev/manual admin callback. Not a live user webhook and cannot fulfill
   * Alipay/PayPal/Stripe/crypto. Use POST /v1/payments/webhooks/:provider/:configId
   * for signed provider events, or admin manual-confirm for mock/manual/contract.
   */
  async handlePayCallback(
    provider: string,
    payload: Record<string, unknown>,
    opts: { actor: string; requestId?: string },
  ) {
    if (!isDevManualProvider(provider)) {
      throw new EntitlementException(
        "NOT_FOUND",
        "Live provider callbacks are not accepted on the admin callback path",
      );
    }
    const adapter = this.adapters.get(provider);
    if (!adapter?.handleCallback) {
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
      return { ignored: true, mode: "dev_manual_callback", liveFulfillment: false };
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
    return { order, result, mode: "dev_manual_callback", liveFulfillment: false };
  }

  private async persistOrder(input: {
    subjectKind: SubjectKind;
    subjectId: string;
    productCode: string | null;
    planCode: PlanCode | null;
    bundleSku: string | null;
    offeringId: string | null;
    offeringSku: string | null;
    interval: BillingInterval | null;
    catalogRevisionId: string | null;
    returnUrl: string | null;
    amountCents: number;
    currency: string;
    paymentProvider: string;
    metadata: Record<string, unknown>;
    actor: string;
    requestId?: string;
  }): Promise<OrderEntity> {
    if (input.amountCents <= 0) {
      throw new EntitlementException(
        "PAYMENT_OFFERING_INVALID",
        "Zero-price user orders are not allowed",
      );
    }
    const order = await this.orders.save(
      this.orders.create({
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        productCode: input.productCode,
        planCode: input.planCode,
        bundleSku: input.bundleSku,
        offeringId: input.offeringId,
        offeringSku: input.offeringSku,
        interval: input.interval,
        catalogRevisionId: input.catalogRevisionId,
        returnUrl: input.returnUrl,
        status: "created",
        amountCents: input.amountCents,
        currency: input.currency,
        paymentProvider: input.paymentProvider,
        metadata: input.metadata,
      }),
    );
    await this.audit.record({
      actor: input.actor,
      action: "order.create",
      resourceType: "order",
      resourceId: order.id,
      requestId: input.requestId,
      payload: {
        provider: input.paymentProvider,
        productCode: order.productCode,
        planCode: order.planCode,
        offeringSku: order.offeringSku,
        amountMinor: order.amountCents,
        currency: order.currency,
        catalogRevisionId: order.catalogRevisionId,
      },
    });
    return order;
  }

  private resolveProvider(providerHint?: string): string {
    const provider = providerHint ?? "mock";
    if (!this.adapters.has(provider)) {
      throw new EntitlementException("VALIDATION_ERROR", `Unknown payment provider ${provider}`);
    }
    return provider;
  }

  private async requireProduct(productCode: string): Promise<ProductEntity> {
    const product = await this.products.findOne({ where: { code: productCode, active: true } });
    if (!product) {
      throw new EntitlementException("NOT_FOUND", `Unknown product ${productCode}`, {
        productCode,
      });
    }
    return product;
  }

  private assertProductSellable(product: ProductEntity): void {
    if (!product.sellable) {
      throw new EntitlementException(
        "PRODUCT_NOT_SELLABLE",
        `Product ${product.code} is not sellable`,
        { productCode: product.code },
      );
    }
  }

  private async fulfillPaidOrder(
    order: OrderEntity,
    providerRef: string,
    opts: { actor: string; requestId?: string },
  ) {
    await this.dataSource.transaction(async (manager) => {
      await fulfillPaidOrderTx(manager, order.id, providerRef);
    });

    Object.assign(order, { status: "fulfilled", providerRef });
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
