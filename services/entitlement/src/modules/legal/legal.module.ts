import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PolicyAcceptanceEntity } from "../../database/entities/policy-acceptance.entity";
import { AuditModule } from "../audit/audit.module";
import { LegalController } from "./legal.controller";
import { LegalService } from "./legal.service";

@Module({
  imports: [AuditModule, TypeOrmModule.forFeature([PolicyAcceptanceEntity])],
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
