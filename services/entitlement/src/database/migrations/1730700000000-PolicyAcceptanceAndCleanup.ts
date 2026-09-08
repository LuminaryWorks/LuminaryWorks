import type { MigrationInterface, QueryRunner } from "typeorm";

export class PolicyAcceptanceAndCleanup1730700000000 implements MigrationInterface {
  name = "PolicyAcceptanceAndCleanup1730700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "policy_acceptances" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "logto_sub" varchar(128) NOT NULL,
        "policy_kind" varchar(64) NOT NULL,
        "policy_version" varchar(64) NOT NULL,
        "document_key" varchar(64) NOT NULL,
        "document_version" varchar(64) NOT NULL,
        "accepted_at" timestamptz NOT NULL,
        "ip" varchar(64),
        "user_agent" varchar(512),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_policy_acceptances_sub_kind_version"
          UNIQUE ("logto_sub", "policy_kind", "policy_version")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_policy_acceptances_logto_sub"
        ON "policy_acceptances" ("logto_sub")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_policy_acceptances_policy_version"
        ON "policy_acceptances" ("policy_version")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trial_cleanup_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trial_redemption_id" uuid NOT NULL,
        "subscription_id" uuid NOT NULL,
        "logto_sub" varchar(128) NOT NULL,
        "product_code" varchar(64) NOT NULL,
        "policy_version" varchar(64) NOT NULL,
        "starts_at" timestamptz NOT NULL,
        "ends_at" timestamptz NOT NULL,
        "scheduled_for" timestamptz NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "attempts" int NOT NULL DEFAULT 0,
        "last_error" text,
        "delivered_at" timestamptz,
        "acked_at" timestamptz,
        "ack_payload" jsonb,
        "outbox_event_id" uuid,
        "organization_id" varchar(128),
        "deployment_id" varchar(128),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_trial_cleanup_jobs_redemption" UNIQUE ("trial_redemption_id"),
        CONSTRAINT "chk_trial_cleanup_jobs_status"
          CHECK ("status" IN ('pending', 'processing', 'delivered', 'acked', 'canceled', 'failed', 'dead'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trial_cleanup_jobs_logto_sub"
        ON "trial_cleanup_jobs" ("logto_sub")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trial_cleanup_jobs_product_code"
        ON "trial_cleanup_jobs" ("product_code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trial_cleanup_jobs_status"
        ON "trial_cleanup_jobs" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trial_cleanup_jobs_scheduled_for"
        ON "trial_cleanup_jobs" ("scheduled_for")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trial_cleanup_jobs_scheduled_for"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trial_cleanup_jobs_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trial_cleanup_jobs_product_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trial_cleanup_jobs_logto_sub"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "trial_cleanup_jobs"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_policy_acceptances_policy_version"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_policy_acceptances_logto_sub"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "policy_acceptances"`);
  }
}
