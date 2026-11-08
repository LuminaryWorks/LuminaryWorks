import type { MigrationInterface, QueryRunner } from "typeorm";

export class AiPlatformConnectionAudit1762600000000 implements MigrationInterface {
  name = "AiPlatformConnectionAudit1762600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS connection_audit_events (
        id uuid PRIMARY KEY,
        action varchar(16) NOT NULL,
        actor_sub varchar(128) NOT NULL,
        actor_kind varchar(16) NOT NULL,
        owner_kind varchar(32) NOT NULL,
        owner_uid varchar(128) NOT NULL,
        connection_uid varchar(64) NOT NULL,
        ok boolean,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS connection_audit_events_connection
      ON connection_audit_events (connection_uid, created_at)`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS connection_audit_events_actor
      ON connection_audit_events (actor_sub, created_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS connection_audit_events`);
  }
}
