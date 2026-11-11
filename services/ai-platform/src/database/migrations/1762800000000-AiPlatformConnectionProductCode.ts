import type { MigrationInterface, QueryRunner } from "typeorm";

export class AiPlatformConnectionProductCode1762800000000 implements MigrationInterface {
  name = "AiPlatformConnectionProductCode1762800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE provider_connections
      ADD COLUMN IF NOT EXISTS product_code varchar(64) NULL`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS provider_connections_owner_product
      ON provider_connections (owner_kind, owner_uid, product_code)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS provider_connections_owner_product`);
    await queryRunner.query(`
      ALTER TABLE provider_connections
      DROP COLUMN IF EXISTS product_code`);
  }
}
