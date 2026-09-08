import type { MigrationInterface, QueryRunner } from "typeorm";

export class ResourceAllocations1730600000000 implements MigrationInterface {
  name = "ResourceAllocations1730600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "features"
        ADD COLUMN IF NOT EXISTS "metering_mode" varchar(16) NOT NULL DEFAULT 'counter'
    `);
    await queryRunner.query(`
      ALTER TABLE "features"
        DROP CONSTRAINT IF EXISTS "chk_features_metering_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "features"
        ADD CONSTRAINT "chk_features_metering_mode"
        CHECK ("metering_mode" IN ('counter', 'gauge'))
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "resource_allocations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "subject_kind" varchar(32) NOT NULL,
        "subject_id" varchar(128) NOT NULL,
        "product_code" varchar(64) NOT NULL,
        "feature_code" varchar(128) NOT NULL,
        "resource_id" varchar(512) NOT NULL,
        "amount" bigint NOT NULL DEFAULT 0,
        "owner_kind" varchar(32),
        "owner_id" varchar(128),
        "source" varchar(64),
        "source_ref" varchar(128),
        "version" int NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_resource_allocations_subject_feature_resource"
          UNIQUE ("subject_kind", "subject_id", "product_code", "feature_code", "resource_id"),
        CONSTRAINT "chk_resource_allocations_amount_nonnegative"
          CHECK ("amount" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_resource_allocations_subject_feature"
        ON "resource_allocations" ("subject_kind", "subject_id", "product_code", "feature_code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_resource_allocations_feature_code"
        ON "resource_allocations" ("feature_code")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_resource_allocations_feature_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_resource_allocations_subject_feature"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "resource_allocations"`);
    await queryRunner.query(`
      ALTER TABLE "features" DROP CONSTRAINT IF EXISTS "chk_features_metering_mode"
    `);
    await queryRunner.query(`ALTER TABLE "features" DROP COLUMN IF EXISTS "metering_mode"`);
  }
}
