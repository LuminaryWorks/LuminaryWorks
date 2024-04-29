import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GrantEntity } from "../../database/entities/grant.entity";
import { LicenseEntity } from "../../database/entities/license.entity";
import { OrganizationSeatEntity } from "../../database/entities/organization-seat.entity";
import { AuditModule } from "../audit/audit.module";
import { LicenseController } from "./license.controller";
import { LicenseService } from "./license.service";

@Module({
  imports: [
    AuditModule,
    TypeOrmModule.forFeature([LicenseEntity, GrantEntity, OrganizationSeatEntity]),
  ],
  controllers: [LicenseController],
  providers: [LicenseService],
  exports: [LicenseService],
})
export class LicenseModule {}
