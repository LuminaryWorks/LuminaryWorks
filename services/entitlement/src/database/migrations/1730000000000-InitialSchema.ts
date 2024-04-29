import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Baseline schema matching spec/subscription-and-entitlement.md §11.
 * In development, TypeORM synchronize may also create tables; this migration
 * is the production path (ENTITLEMENT_MIGRATIONS_RUN=true).
 */
export class InitialSchema1730000000000 implements MigrationInterface {
  name = "InitialSchema1730000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(64) NOT NULL UNIQUE,
        name varchar(128) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS features (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        code varchar(128) NOT NULL,
        name varchar(256) NOT NULL,
        kind varchar(16) NOT NULL DEFAULT 'bool',
        quota_period varchar(32),
        quota_merge varchar(8) NOT NULL DEFAULT 'max',
        description text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(product_id, code)
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        code varchar(32) NOT NULL,
        name varchar(128) NOT NULL,
        rank int NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(product_id, code)
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS plan_features (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        feature_id uuid NOT NULL REFERENCES features(id) ON DELETE CASCADE,
        effect varchar(8) NOT NULL DEFAULT 'allow',
        limit_value bigint,
        quota_merge varchar(8),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(plan_id, feature_id)
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bundles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sku varchar(64) NOT NULL UNIQUE,
        name varchar(128) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bundle_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bundle_id uuid NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
        product_code varchar(64) NOT NULL,
        plan_code varchar(32) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_kind varchar(32) NOT NULL,
        subject_id varchar(128) NOT NULL,
        product_code varchar(64) NOT NULL,
        plan_code varchar(32) NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'active',
        starts_at timestamptz NOT NULL,
        ends_at timestamptz,
        source varchar(64) NOT NULL,
        source_ref varchar(128),
        organization_id varchar(128),
        canceled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_subject ON subscriptions(subject_kind, subject_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_product ON subscriptions(product_code)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS grants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_kind varchar(32) NOT NULL,
        subject_id varchar(128) NOT NULL,
        product_code varchar(64) NOT NULL,
        plan_code varchar(32),
        features jsonb NOT NULL DEFAULT '{}',
        starts_at timestamptz NOT NULL,
        ends_at timestamptz,
        source varchar(64) NOT NULL,
        source_ref varchar(128),
        revoked boolean NOT NULL DEFAULT false,
        revoked_at timestamptz,
        organization_id varchar(128),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS organization_seats (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id varchar(128) NOT NULL,
        product_code varchar(64) NOT NULL,
        seat_limit int NOT NULL,
        seat_used int NOT NULL DEFAULT 0,
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(organization_id, product_code)
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS usage_counters (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_kind varchar(32) NOT NULL,
        subject_id varchar(128) NOT NULL,
        product_code varchar(64) NOT NULL,
        feature_code varchar(128) NOT NULL,
        period_key varchar(64) NOT NULL,
        period varchar(32) NOT NULL,
        used bigint NOT NULL DEFAULT 0,
        limit_value bigint,
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(subject_kind, subject_id, product_code, feature_code, period_key)
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS trial_redemptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        logto_sub varchar(128) NOT NULL,
        product_code varchar(64) NOT NULL,
        subscription_id uuid NOT NULL,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(logto_sub, product_code)
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS consume_idempotency (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        idempotency_key varchar(128) NOT NULL UNIQUE,
        response jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_kind varchar(32) NOT NULL,
        subject_id varchar(128) NOT NULL,
        product_code varchar(64),
        plan_code varchar(32),
        bundle_sku varchar(64),
        status varchar(32) NOT NULL DEFAULT 'pending',
        amount_cents int NOT NULL DEFAULT 0,
        currency varchar(8) NOT NULL DEFAULT 'USD',
        payment_provider varchar(64) NOT NULL DEFAULT 'mock',
        provider_ref varchar(128),
        metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider varchar(64) NOT NULL,
        event_id varchar(128),
        payload jsonb NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'received',
        error text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type varchar(64) NOT NULL,
        dedupe_key varchar(256) NOT NULL UNIQUE,
        payload jsonb NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'pending',
        attempts int NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        scheduled_for timestamptz,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor varchar(128) NOT NULL,
        action varchar(64) NOT NULL,
        resource_type varchar(64) NOT NULL,
        resource_id varchar(128),
        reason varchar(256),
        request_id varchar(128),
        payload jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS partners (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(64) NOT NULL UNIQUE,
        name varchar(128) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        client_id varchar(128),
        metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS partner_benefits (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
        product_code varchar(64) NOT NULL,
        plan_code varchar(32) NOT NULL,
        duration_days int,
        features jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS redemptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        redemption_id varchar(128) NOT NULL UNIQUE,
        partner_id uuid NOT NULL,
        logto_sub varchar(128),
        status varchar(32) NOT NULL DEFAULT 'active',
        grant_id uuid,
        payload jsonb NOT NULL DEFAULT '{}',
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        license_id varchar(128) NOT NULL UNIQUE,
        deployment_id varchar(128) NOT NULL,
        kid varchar(64) NOT NULL,
        payload jsonb NOT NULL,
        signature text,
        expires_at timestamptz,
        offline_grace_days int NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      "licenses",
      "redemptions",
      "partner_benefits",
      "partners",
      "audit_logs",
      "outbox_events",
      "webhook_events",
      "orders",
      "consume_idempotency",
      "trial_redemptions",
      "usage_counters",
      "organization_seats",
      "grants",
      "subscriptions",
      "bundle_items",
      "bundles",
      "plan_features",
      "plans",
      "features",
      "products",
    ];
    for (const t of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
  }
}
