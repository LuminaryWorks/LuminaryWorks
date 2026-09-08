import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GrantEntity } from "../../database/entities/grant.entity";
import { LicenseEntity } from "../../database/entities/license.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { ProductEntity } from "../../database/entities/product.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { TrialCleanupJobEntity } from "../../database/entities/trial-cleanup-job.entity";
import { TrialRedemptionEntity } from "../../database/entities/trial-redemption.entity";
import { AuditModule } from "../audit/audit.module";
import { LegalModule } from "../legal/legal.module";
import { TrialsController } from "./trials.controller";
import { TrialsService } from "./trials.service";

@Module({
  imports: [
    AuditModule,
    LegalModule,
    TypeOrmModule.forFeature([
      TrialRedemptionEntity,
      SubscriptionEntity,
      GrantEntity,
      LicenseEntity,
      OutboxEventEntity,
      ProductEntity,
      TrialCleanupJobEntity,
    ]),
  ],
  controllers: [TrialsController],
  providers: [TrialsService],
  exports: [TrialsService],
})
export class TrialsModule {}
