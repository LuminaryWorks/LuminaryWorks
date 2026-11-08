import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GrantEntity } from "../../database/entities/grant.entity";
import { OrderEntity } from "../../database/entities/order.entity";
import { OrganizationSeatEntity } from "../../database/entities/organization-seat.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { AuditModule } from "../audit/audit.module";
import { ProductLifecycleService } from "../catalog/product-lifecycle.service";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [
    AuditModule,
    EntitlementsModule,
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      GrantEntity,
      OrganizationSeatEntity,
      OutboxEventEntity,
      ProductEntity,
      OrderEntity,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService, ProductLifecycleService],
  exports: [AdminService],
})
export class AdminModule {}
