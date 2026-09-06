import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GrantEntity } from "../../database/entities/grant.entity";
import { PromotionRedemptionEntity } from "../../database/entities/promotion-redemption.entity";
import { AuditModule } from "../audit/audit.module";
import { PromotionsController } from "./promotions.controller";
import { PromotionsService } from "./promotions.service";

@Module({
  imports: [AuditModule, TypeOrmModule.forFeature([PromotionRedemptionEntity, GrantEntity])],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
