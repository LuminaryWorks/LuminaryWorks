import type { MigrationInterface, QueryRunner } from "typeorm";

export class PaymentCatalogOrder1731100000000 implements MigrationInterface {
  name = "PaymentCatalogOrder1731100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_catalog_orders" (
        "scope_key" varchar(160) PRIMARY KEY,
        "provider_ids" jsonb NOT NULL DEFAULT '[]',
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_catalog_orders"`);
  }
}
