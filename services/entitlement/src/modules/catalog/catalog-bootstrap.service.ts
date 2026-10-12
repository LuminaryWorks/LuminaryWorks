import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { applyCatalog } from "../../database/seed-apply";

/** Apply the shipped catalog on boot so the next deploy updates plan limits. */
@Injectable()
export class CatalogBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(CatalogBootstrapService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await applyCatalog(this.dataSource);
    this.logger.log("Entitlement catalog applied");
  }
}
