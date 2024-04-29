import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GrantEntity } from "../../database/entities/grant.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { PartnerEntity } from "../../database/entities/partner.entity";
import { PartnerBenefitEntity } from "../../database/entities/partner-benefit.entity";
import { PartnerNonceEntity } from "../../database/entities/partner-nonce.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { RedemptionEntity } from "../../database/entities/redemption.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { AuditModule } from "../audit/audit.module";
import {
  AdminPartnersController,
  PartnerController,
  PartnerOAuthController,
} from "./partner.controller";
import { PartnerRedemptionService } from "./partner-redemption.service";
import { PartnerRegistryService } from "./partner-registry.service";
import { PartnerWebhookService } from "./partner-webhook.service";

@Module({
  imports: [
    AuditModule,
    TypeOrmModule.forFeature([
      PartnerEntity,
      PartnerBenefitEntity,
      PartnerNonceEntity,
      RedemptionEntity,
      GrantEntity,
      SubscriptionEntity,
      OutboxEventEntity,
      ProductEntity,
    ]),
  ],
  controllers: [PartnerOAuthController, AdminPartnersController, PartnerController],
  providers: [PartnerRegistryService, PartnerRedemptionService, PartnerWebhookService],
  exports: [PartnerRegistryService, PartnerRedemptionService, PartnerWebhookService],
})
export class PartnerModule {}
