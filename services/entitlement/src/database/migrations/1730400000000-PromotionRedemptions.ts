import type { MigrationInterface, QueryRunner } from "typeorm";

export class PromotionRedemptions1730400000000 implements MigrationInterface {
  name = "PromotionRedemptions1730400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promotion_redemptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "subject_id" varchar(128) NOT NULL,
        "product_code" varchar(64) NOT NULL,
        "promotion_code" varchar(128) NOT NULL,
        "grant_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotion_redemptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_promotion_redemptions_subject_product_code"
          UNIQUE ("subject_id", "product_code", "promotion_code")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_promotion_redemptions_subject"
        ON "promotion_redemptions" ("subject_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "promotion_redemptions"`);
  }
}
