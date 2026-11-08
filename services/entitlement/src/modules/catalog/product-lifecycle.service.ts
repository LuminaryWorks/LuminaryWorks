import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, type Repository } from "typeorm";
import { EntitlementException } from "../../common/errors";
import {
  isProductLifecycleStatus,
  readLifecycleStatus,
  type ProductLifecycleStatus,
} from "../../common/product-lifecycle";
import { OrderEntity } from "../../database/entities/order.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { AuditService } from "../audit/audit.service";
import { revokeOrderEntitlements } from "../orders/order-fulfillment";

@Injectable()
export class ProductLifecycleService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
    private readonly audit: AuditService,
  ) {}

  async get(productCode: string) {
    const product = await this.requireProduct(productCode);
    return this.toView(product);
  }

  async setStatus(
    productCode: string,
    status: string,
    opts: { actor: string; requestId?: string; reason?: string },
  ) {
    if (!isProductLifecycleStatus(status)) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "status must be active, suspended, or retired",
      );
    }
    const product = await this.requireProduct(productCode);
    const previous = readLifecycleStatus(product.status);
    product.status = status;
    await this.products.save(product);
    await this.audit.record({
      actor: opts.actor,
      action: "product.lifecycle",
      resourceType: "product",
      resourceId: product.id,
      requestId: opts.requestId,
      reason: opts.reason ?? null,
      payload: { productCode: product.code, previous, status },
    });
    return { ...this.toView(product), previous };
  }

  /**
   * Cuts paid access now. Wraps revokeOrderEntitlements for every order that
   * sold this product, plus orders referenced by current order-sourced subscriptions.
   * Suspension alone does not call this — paid access continues until period end.
   */
  async forceRevoke(
    productCode: string,
    opts: { actor: string; requestId?: string; reason: string },
  ) {
    const reason = opts.reason?.trim() ?? "";
    if (!reason) {
      throw new EntitlementException("VALIDATION_ERROR", "reason is required");
    }
    const product = await this.requireProduct(productCode);
    const direct = await this.orders.find({ where: { productCode: product.code } });
    const subs = await this.subscriptions.find({
      where: { productCode: product.code, source: "order" },
    });
    const known = new Set(direct.map((order) => order.id));
    const missing = [
      ...new Set(
        subs
          .map((sub) => sub.sourceRef)
          .filter((id): id is string => typeof id === "string" && !known.has(id)),
      ),
    ];
    const extra = missing.length ? await this.orders.find({ where: { id: In(missing) } }) : [];
    const targets = [...direct, ...extra];
    const revokedAt = new Date();
    for (const order of targets) {
      await this.dataSource.transaction(async (manager) => {
        await revokeOrderEntitlements(manager, order, revokedAt);
      });
    }
    await this.audit.record({
      actor: opts.actor,
      action: "product.force_revoke",
      resourceType: "product",
      resourceId: product.id,
      requestId: opts.requestId,
      reason,
      payload: {
        productCode: product.code,
        ordersTouched: targets.length,
        orderIds: targets.map((order) => order.id),
      },
    });
    return {
      productCode: product.code,
      status: readLifecycleStatus(product.status),
      ordersTouched: targets.length,
      revokedAt: revokedAt.toISOString(),
    };
  }

  private async requireProduct(productCode: string): Promise<ProductEntity> {
    const code = productCode.trim();
    const product = await this.products.findOne({ where: { code } });
    if (!product) {
      throw new EntitlementException("NOT_FOUND", `Unknown product ${code}`, { productCode: code });
    }
    return product;
  }

  private toView(product: ProductEntity) {
    return {
      productCode: product.code,
      name: product.name,
      active: product.active,
      sellable: product.sellable,
      status: readLifecycleStatus(product.status) satisfies ProductLifecycleStatus,
    };
  }
}
