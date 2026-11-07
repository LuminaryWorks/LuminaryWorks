import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProviderConnectionEntity } from "../database/entities";
import { HealthController } from "./health.controller";
import { ConnectionsHealthIndicator, VaultHealthIndicator } from "./health.indicators";

@Module({
  imports: [TerminusModule, TypeOrmModule.forFeature([ProviderConnectionEntity])],
  controllers: [HealthController],
  providers: [VaultHealthIndicator, ConnectionsHealthIndicator],
})
export class HealthModule {}
