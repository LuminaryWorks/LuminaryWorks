import type { MigrationInterface, QueryRunner } from "typeorm";

export class PaymentChannelLifecycle1731000000000 implements MigrationInterface {
  name = "PaymentChannelLifecycle1731000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_provider_configs"
        ADD COLUMN IF NOT EXISTS "tenant_id" varchar(128)
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_provider_configs"
        ADD COLUMN IF NOT EXISTS "last_test_ok" boolean
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_provider_configs"
        ADD COLUMN IF NOT EXISTS "last_tested_at" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_provider_configs"
        ADD COLUMN IF NOT EXISTS "last_test_issues" jsonb NOT NULL DEFAULT '[]'
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_provider_configs"
        ADD COLUMN IF NOT EXISTS "last_test_fingerprint" varchar(64) NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_provider_configs"
        ADD COLUMN IF NOT EXISTS "last_test_environment" varchar(16)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_provider_configs_tenant"
        ON "payment_provider_configs" ("tenant_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payment_provider_configs_tenant"`);
    await queryRunner.query(`
      ALTER TABLE "payment_provider_configs"
        DROP COLUMN IF EXISTS "last_test_environment",
        DROP COLUMN IF EXISTS "last_test_fingerprint",
        DROP COLUMN IF EXISTS "last_test_issues",
        DROP COLUMN IF EXISTS "last_tested_at",
        DROP COLUMN IF EXISTS "last_test_ok",
        DROP COLUMN IF EXISTS "tenant_id"
    `);
  }
}
