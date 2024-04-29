import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Multi-instance outbox safety: lease columns + claim index for
 * SELECT … FOR UPDATE SKIP LOCKED.
 */
export class OutboxLeaseClaim1730200000000 implements MigrationInterface {
  name = "OutboxLeaseClaim1730200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "outbox_events"
        ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "locked_by" VARCHAR(128) NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_events_claim"
        ON "outbox_events" ("status", "next_attempt_at", "scheduled_for")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_events_locked_until"
        ON "outbox_events" ("locked_until")
        WHERE "locked_until" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_events_locked_until"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_events_claim"`);
    await queryRunner.query(`
      ALTER TABLE "outbox_events"
        DROP COLUMN IF EXISTS "locked_by",
        DROP COLUMN IF EXISTS "locked_until"
    `);
  }
}
