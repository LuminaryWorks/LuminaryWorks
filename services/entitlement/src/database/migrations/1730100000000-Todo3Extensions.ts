import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Todo 3: partner credentials, replay nonces, notification prefs,
 * outbox dead-letter fields, license activation, redemption detail columns.
 */
export class Todo3Extensions1730100000000 implements MigrationInterface {
  name = "Todo3Extensions1730100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE partners
        ADD COLUMN IF NOT EXISTS client_secret_hash varchar(128),
        ADD COLUMN IF NOT EXISTS webhook_secret varchar(256),
        ADD COLUMN IF NOT EXISTS webhook_url varchar(512),
        ADD COLUMN IF NOT EXISTS scopes jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_client_id
        ON partners (client_id) WHERE client_id IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE redemptions
        ADD COLUMN IF NOT EXISTS benefit_id uuid,
        ADD COLUMN IF NOT EXISTS product_code varchar(64),
        ADD COLUMN IF NOT EXISTS subscription_id uuid,
        ADD COLUMN IF NOT EXISTS starts_at timestamptz,
        ADD COLUMN IF NOT EXISTS ends_at timestamptz
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_redemptions_partner_id ON redemptions (partner_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS partner_nonces (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        partner_id uuid NOT NULL,
        nonce varchar(128) NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (partner_id, nonce)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        logto_sub varchar(128) NOT NULL UNIQUE,
        email_enabled boolean NOT NULL DEFAULT true,
        in_app_enabled boolean NOT NULL DEFAULT true,
        push_enabled boolean NOT NULL DEFAULT true,
        email_address varchar(320),
        push_tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE outbox_events
        ADD COLUMN IF NOT EXISTS max_attempts int NOT NULL DEFAULT 8,
        ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz
    `);

    await queryRunner.query(`
      ALTER TABLE licenses
        ADD COLUMN IF NOT EXISTS activated_at timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notification_preferences CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS partner_nonces CASCADE`);
    await queryRunner.query(`ALTER TABLE licenses DROP COLUMN IF EXISTS activated_at`);
    await queryRunner.query(`
      ALTER TABLE outbox_events
        DROP COLUMN IF EXISTS max_attempts,
        DROP COLUMN IF EXISTS dead_lettered_at
    `);
    await queryRunner.query(`
      ALTER TABLE redemptions
        DROP COLUMN IF EXISTS benefit_id,
        DROP COLUMN IF EXISTS product_code,
        DROP COLUMN IF EXISTS subscription_id,
        DROP COLUMN IF EXISTS starts_at,
        DROP COLUMN IF EXISTS ends_at
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_partners_client_id`);
    await queryRunner.query(`
      ALTER TABLE partners
        DROP COLUMN IF EXISTS client_secret_hash,
        DROP COLUMN IF EXISTS webhook_secret,
        DROP COLUMN IF EXISTS webhook_url,
        DROP COLUMN IF EXISTS scopes
    `);
  }
}
