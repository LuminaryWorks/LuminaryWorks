import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CatalogRevisionEntity } from "../../database/entities/catalog-revision.entity";
import { FeatureEntity } from "../../database/entities/feature.entity";
import { OfferingEntity } from "../../database/entities/offering.entity";
import { PlanEntity } from "../../database/entities/plan.entity";
import { PlanFeatureEntity } from "../../database/entities/plan-feature.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { AuditModule } from "../audit/audit.module";
import { CatalogAdminController } from "./catalog-admin.controller";
import { CatalogAdminService } from "./catalog-admin.service";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({
  imports: [
    AuditModule,
    TypeOrmModule.forFeature([
      ProductEntity,
      PlanEntity,
      FeatureEntity,
      PlanFeatureEntity,
      CatalogRevisionEntity,
      OfferingEntity,
    ]),
  ],
  controllers: [CatalogController, CatalogAdminController],
  providers: [CatalogService, CatalogAdminService],
  exports: [CatalogService, CatalogAdminService],
})
export class CatalogModule {}
