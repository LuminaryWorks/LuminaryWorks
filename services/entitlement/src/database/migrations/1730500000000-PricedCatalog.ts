import type { MigrationInterface, QueryRunner } from "typeorm";

export class PricedCatalog1730500000000 implements MigrationInterface {
  name = "PricedCatalog1730500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "sellable" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "catalog_revisions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "version" int NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'draft',
        "notes" text,
        "published_at" timestamptz,
        "superseded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_catalog_revisions_version" UNIQUE ("version"),
        CONSTRAINT "chk_catalog_revisions_status"
          CHECK ("status" IN ('draft', 'published', 'superseded'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_catalog_revisions_one_published"
        ON "catalog_revisions" ("status")
        WHERE "status" = 'published'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "offerings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "sku" varchar(64) NOT NULL,
        "product_code" varchar(64) NOT NULL,
        "plan_code" varchar(32) NOT NULL,
        "billing_interval" varchar(16) NOT NULL,
        "currency" varchar(8) NOT NULL,
        "amount_minor" int NOT NULL,
        "market" varchar(16) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "catalog_revision_id" uuid NOT NULL REFERENCES "catalog_revisions"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_offerings_revision_sku" UNIQUE ("catalog_revision_id", "sku"),
        CONSTRAINT "chk_offerings_interval"
          CHECK ("billing_interval" IN ('month', 'year')),
        CONSTRAINT "chk_offerings_market"
          CHECK ("market" IN ('CN', 'GLOBAL')),
        CONSTRAINT "chk_offerings_plan_code"
          CHECK ("plan_code" IN ('pro', 'ultra')),
        CONSTRAINT "chk_offerings_amount_minor"
          CHECK ("amount_minor" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_offerings_product_code" ON "offerings" ("product_code")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_offerings_revision_id" ON "offerings" ("catalog_revision_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "offering_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "offering_sku" varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "billing_interval" varchar(16)
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "catalog_revision_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "return_url" varchar(2048)
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "chk_orders_billing_interval"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "chk_orders_billing_interval"
        CHECK ("billing_interval" IS NULL OR "billing_interval" IN ('month', 'year'))
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "fk_orders_catalog_revision"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "fk_orders_catalog_revision"
        FOREIGN KEY ("catalog_revision_id") REFERENCES "catalog_revisions"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "fk_orders_offering"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "fk_orders_offering"
        FOREIGN KEY ("offering_id") REFERENCES "offerings"("id")
        ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "fk_orders_offering"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "fk_orders_catalog_revision"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "chk_orders_billing_interval"
    `);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "return_url"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "catalog_revision_id"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "billing_interval"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "offering_sku"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "offering_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "offerings"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_catalog_revisions_one_published"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "catalog_revisions"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "sellable"`);
  }
}
