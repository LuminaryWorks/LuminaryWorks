import type { MigrationInterface, QueryRunner } from "typeorm";

export class PaymentPlatform1730800000000 implements MigrationInterface {
  name = "PaymentPlatform1730800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_provider_configs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider_id" varchar(64) NOT NULL,
        "environment" varchar(16) NOT NULL DEFAULT 'sandbox',
        "enabled" boolean NOT NULL DEFAULT false,
        "status" varchar(32) NOT NULL DEFAULT 'disabled',
        "market_scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "currencies" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "priority" int NOT NULL DEFAULT 100,
        "capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "merchant_id" varchar(128),
        "credentials_ciphertext" text NOT NULL DEFAULT '',
        "previous_credentials_ciphertext" text,
        "previous_retiring_until" timestamptz,
        "credential_fingerprint" varchar(64) NOT NULL DEFAULT '',
        "credential_last_four" varchar(8) NOT NULL DEFAULT '****',
        "key_fingerprint" varchar(32) NOT NULL DEFAULT '',
        "rotated_at" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_payment_provider_configs_environment"
          CHECK ("environment" IN ('sandbox', 'live')),
        CONSTRAINT "chk_payment_provider_configs_status"
          CHECK ("status" IN ('active', 'disabled', 'retiring'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_provider_configs_provider_id"
        ON "payment_provider_configs" ("provider_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_provider_configs_enabled"
        ON "payment_provider_configs" ("enabled")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_attempts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "config_id" uuid REFERENCES "payment_provider_configs"("id") ON DELETE SET NULL,
        "provider" varchar(64) NOT NULL,
        "provider_ref" varchar(128),
        "status" varchar(32) NOT NULL DEFAULT 'created',
        "amount_cents" int NOT NULL,
        "currency" varchar(8) NOT NULL,
        "merchant_id" varchar(128),
        "checkout_url" varchar(2048),
        "qr_payload" text,
        "action" jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_payment_attempts_status"
          CHECK ("status" IN ('created', 'pending', 'succeeded', 'failed', 'canceled', 'expired'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_attempts_order_id"
        ON "payment_attempts" ("order_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_attempts_provider"
        ON "payment_attempts" ("provider")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_attempts_status"
        ON "payment_attempts" ("status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "provider_webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider" varchar(64) NOT NULL,
        "config_id" uuid NOT NULL REFERENCES "payment_provider_configs"("id") ON DELETE CASCADE,
        "event_id" varchar(128) NOT NULL,
        "raw_body_sha256" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar(32) NOT NULL DEFAULT 'received',
        "order_id" uuid,
        "attempt_id" uuid,
        "error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_provider_webhook_events_provider_config_event"
          UNIQUE ("provider", "config_id", "event_id"),
        CONSTRAINT "chk_provider_webhook_events_status"
          CHECK ("status" IN ('received', 'processed', 'ignored', 'duplicate', 'failed'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_provider_webhook_events_provider"
        ON "provider_webhook_events" ("provider")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_provider_webhook_events_config_id"
        ON "provider_webhook_events" ("config_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refunds" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "attempt_id" uuid REFERENCES "payment_attempts"("id") ON DELETE SET NULL,
        "idempotency_key" varchar(128) NOT NULL,
        "amount_cents" int NOT NULL,
        "currency" varchar(8) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "provider_ref" varchar(128),
        "actor" varchar(128) NOT NULL,
        "reason" varchar(512) NOT NULL,
        "ticket" varchar(128),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_refunds_idempotency_key" UNIQUE ("idempotency_key"),
        CONSTRAINT "chk_refunds_status"
          CHECK ("status" IN ('pending', 'succeeded', 'failed')),
        CONSTRAINT "chk_refunds_amount_cents" CHECK ("amount_cents" > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refunds_order_id" ON "refunds" ("order_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_profiles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "subject_kind" varchar(32) NOT NULL,
        "subject_id" varchar(128) NOT NULL,
        "country" varchar(8) NOT NULL,
        "source" varchar(32) NOT NULL DEFAULT 'user',
        "locked" boolean NOT NULL DEFAULT false,
        "locked_at" timestamptz,
        "locked_reason" varchar(256),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_billing_profiles_subject" UNIQUE ("subject_kind", "subject_id"),
        CONSTRAINT "chk_billing_profiles_country" CHECK (char_length("country") = 2)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_billing_profiles_subject_id"
        ON "billing_profiles" ("subject_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "payment_config_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ALTER COLUMN "status" SET DEFAULT 'created'
    `);
    await queryRunner.query(`
      ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "chk_orders_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "chk_orders_status"
        CHECK ("status" IN (
          'pending',
          'created',
          'pending_payment',
          'paid',
          'fulfilled',
          'failed',
          'canceled',
          'expired',
          'refund_pending',
          'partially_refunded',
          'refunded'
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "chk_orders_status"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "payment_config_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_billing_profiles_subject_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_profiles"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refunds_order_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refunds"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_webhook_events_config_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_webhook_events_provider"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "provider_webhook_events"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_attempts_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_attempts_provider"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_attempts_order_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_attempts"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_provider_configs_enabled"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_provider_configs_provider_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_provider_configs"`);
  }
}
