import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BundleEntity } from "../../database/entities/bundle.entity";
import { BundleItemEntity } from "../../database/entities/bundle-item.entity";
import { GrantEntity } from "../../database/entities/grant.entity";
import { OrderEntity } from "../../database/entities/order.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { WebhookEventEntity } from "../../database/entities/webhook-event.entity";
import { AuditModule } from "../audit/audit.module";
import { CatalogModule } from "../catalog/catalog.module";
import { PaymentsModule } from "../payments/payments.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [
    AuditModule,
    CatalogModule,
    PaymentsModule,
    TypeOrmModule.forFeature([
      OrderEntity,
      BundleEntity,
      BundleItemEntity,
      WebhookEventEntity,
      SubscriptionEntity,
      GrantEntity,
      ProductEntity,
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
