import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Product kill-switch plus payment isolation columns.
 * product_code on refunds and attempts is copied from the parent order.
 * Rows whose order has no product_code stay null. No synthetic product default.
 */
export class ProductIsolation1731200000000 implements MigrationInterface {
  name = "ProductIsolation1731200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "status" varchar(16) NOT NULL DEFAULT 'active'
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_lifecycle_status'
        ) THEN
          ALTER TABLE "products"
            ADD CONSTRAINT "chk_products_lifecycle_status"
            CHECK ("status" IN ('active', 'suspended', 'retired'));
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "payment_provider_configs"
        ADD COLUMN IF NOT EXISTS "merchant_account_id" varchar(128)
    `);

    await queryRunner.query(`
      ALTER TABLE "refunds"
        ADD COLUMN IF NOT EXISTS "product_code" varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_attempts"
        ADD COLUMN IF NOT EXISTS "product_code" varchar(64)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refunds_product_code"
        ON "refunds" ("product_code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_attempts_product_code"
        ON "payment_attempts" ("product_code")
    `);

    await queryRunner.query(`
      UPDATE "refunds" AS r
      SET "product_code" = o."product_code"
      FROM "orders" AS o
      WHERE r."order_id" = o."id"
        AND r."product_code" IS NULL
        AND o."product_code" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "payment_attempts" AS a
      SET "product_code" = o."product_code"
      FROM "orders" AS o
      WHERE a."order_id" = o."id"
        AND a."product_code" IS NULL
        AND o."product_code" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_attempts_product_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refunds_product_code"`);
    await queryRunner.query(`ALTER TABLE "payment_attempts" DROP COLUMN IF EXISTS "product_code"`);
    await queryRunner.query(`ALTER TABLE "refunds" DROP COLUMN IF EXISTS "product_code"`);
    await queryRunner.query(`
      ALTER TABLE "payment_provider_configs" DROP COLUMN IF EXISTS "merchant_account_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "chk_products_lifecycle_status"
    `);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "status"`);
  }
}
