import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GrantEntity } from "../../database/entities/grant.entity";
import { OrganizationSeatEntity } from "../../database/entities/organization-seat.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { AuditModule } from "../audit/audit.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [
    AuditModule,
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      GrantEntity,
      OrganizationSeatEntity,
      OutboxEventEntity,
      ProductEntity,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
