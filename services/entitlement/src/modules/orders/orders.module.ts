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
import {
  ContractPaymentAdapter,
  ManualPaymentAdapter,
  MockPaymentAdapter,
} from "../payments/adapters";
import { PAYMENT_ADAPTERS } from "../payments/payment-adapter";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [
    AuditModule,
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
  providers: [
    MockPaymentAdapter,
    ManualPaymentAdapter,
    ContractPaymentAdapter,
    {
      provide: PAYMENT_ADAPTERS,
      useFactory: (
        mock: MockPaymentAdapter,
        manual: ManualPaymentAdapter,
        contract: ContractPaymentAdapter,
      ) => [mock, manual, contract],
      inject: [MockPaymentAdapter, ManualPaymentAdapter, ContractPaymentAdapter],
    },
    OrdersService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
