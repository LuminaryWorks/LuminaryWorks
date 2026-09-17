import type { MigrationInterface, QueryRunner } from "typeorm";

export class BillingProfilePayerType1730900000000 implements MigrationInterface {
  name = "BillingProfilePayerType1730900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_profiles"
        ADD COLUMN IF NOT EXISTS "payer_type" varchar(16) NOT NULL DEFAULT 'individual'
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles"
        ADD COLUMN IF NOT EXISTS "company_name" varchar(256)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles"
        ADD COLUMN IF NOT EXISTS "tax_id" varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles"
        ADD COLUMN IF NOT EXISTS "address_line1" varchar(256)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles"
        ADD COLUMN IF NOT EXISTS "city" varchar(128)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles"
        ADD COLUMN IF NOT EXISTS "postal_code" varchar(32)
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles"
        DROP CONSTRAINT IF EXISTS "chk_billing_profiles_payer_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles"
        ADD CONSTRAINT "chk_billing_profiles_payer_type"
        CHECK ("payer_type" IN ('individual', 'business'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_profiles"
        DROP CONSTRAINT IF EXISTS "chk_billing_profiles_payer_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles" DROP COLUMN IF EXISTS "postal_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles" DROP COLUMN IF EXISTS "city"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles" DROP COLUMN IF EXISTS "address_line1"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles" DROP COLUMN IF EXISTS "tax_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles" DROP COLUMN IF EXISTS "company_name"
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_profiles" DROP COLUMN IF EXISTS "payer_type"
    `);
  }
}
