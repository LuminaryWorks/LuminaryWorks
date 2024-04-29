import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FeatureEntity } from "../../database/entities/feature.entity";
import { PlanEntity } from "../../database/entities/plan.entity";
import { PlanFeatureEntity } from "../../database/entities/plan-feature.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductEntity, PlanEntity, FeatureEntity, PlanFeatureEntity]),
  ],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
