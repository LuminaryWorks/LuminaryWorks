import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AiUsageEventEntity } from "../database/entities/ai-usage-event.entity";
import { WalletService } from "../wallet/wallet.service";
import { MeController } from "./me.controller";

@Module({
  imports: [TypeOrmModule.forFeature([AiUsageEventEntity])],
  controllers: [MeController],
  providers: [WalletService],
})
export class MeModule {}
