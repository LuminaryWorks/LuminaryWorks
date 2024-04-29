import type { MigrationInterface, QueryRunner } from "typeorm";

export class ProductTrialPolicy1730300000000 implements MigrationInterface {
  name = "ProductTrialPolicy1730300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "trial_policy" VARCHAR(32) NOT NULL DEFAULT 'standard_7d'
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT IF EXISTS "chk_products_trial_policy"
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD CONSTRAINT "chk_products_trial_policy"
        CHECK ("trial_policy" IN ('standard_7d', 'disabled'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP CONSTRAINT IF EXISTS "chk_products_trial_policy"
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "trial_policy"
    `);
  }
}
