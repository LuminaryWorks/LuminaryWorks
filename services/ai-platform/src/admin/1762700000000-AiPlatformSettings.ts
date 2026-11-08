import type { MigrationInterface, QueryRunner } from "typeorm";

export class AiPlatformSettings1762700000000 implements MigrationInterface {
  name = "AiPlatformSettings1762700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        setting_key varchar(64) PRIMARY KEY,
        value_json jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_setting_audits (
        id uuid PRIMARY KEY,
        setting_key varchar(64) NOT NULL,
        actor_sub varchar(128) NOT NULL,
        previous_json jsonb,
        next_json jsonb NOT NULL,
        reason varchar(512),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS platform_setting_audits_key
      ON platform_setting_audits (setting_key, created_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS platform_setting_audits`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_settings`);
  }
}
