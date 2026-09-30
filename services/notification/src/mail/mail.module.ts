import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EmailMessageEntity } from "../database/entities/email-message.entity";
import { MailProfileEntity } from "../database/entities/mail-profile.entity";
import { ProviderQuotaEntity } from "../database/entities/provider-quota.entity";
import { AuthMailService } from "./auth-mail.service";
import { MailController } from "./mail.controller";
import { ProfilesService } from "./profiles.service";
import { QuotaService } from "./quota.service";

@Module({
  imports: [TypeOrmModule.forFeature([MailProfileEntity, EmailMessageEntity, ProviderQuotaEntity])],
  controllers: [MailController],
  providers: [AuthMailService, ProfilesService, QuotaService],
})
export class MailModule {}
