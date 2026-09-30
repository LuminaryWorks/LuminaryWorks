import type { MigrationInterface, QueryRunner } from "typeorm";

export class AuthMail1740000000000 implements MigrationInterface {
  name = "AuthMail1740000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mail_profiles (
        id uuid PRIMARY KEY,
        scope varchar(32) NOT NULL,
        organization_id varchar(128),
        from_address varchar(320) NOT NULL,
        from_name varchar(128),
        provider varchar(16) NOT NULL,
        credentials_cipher text NOT NULL,
        match_domains jsonb NOT NULL DEFAULT '[]',
        verified boolean NOT NULL DEFAULT false,
        enabled boolean NOT NULL DEFAULT true,
        usage varchar(16) NOT NULL DEFAULT 'auth',
        priority integer NOT NULL DEFAULT 100,
        daily_quota integer NOT NULL DEFAULT 0,
        monthly_quota integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS mail_profiles_scope_org
      ON mail_profiles (scope, organization_id)`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS email_messages (
        id uuid PRIMARY KEY,
        idempotency_key varchar(64) NOT NULL UNIQUE,
        usage_type varchar(64) NOT NULL,
        to_address varchar(320) NOT NULL,
        status varchar(16) NOT NULL,
        provider_id varchar(128),
        provider_message_id varchar(256),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_quota_counters (
        provider_key varchar(128) NOT NULL,
        period_key varchar(16) NOT NULL,
        sent_count integer NOT NULL DEFAULT 0,
        PRIMARY KEY (provider_key, period_key)
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS provider_quota_counters`);
    await queryRunner.query(`DROP TABLE IF EXISTS email_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS mail_profiles`);
  }
}
