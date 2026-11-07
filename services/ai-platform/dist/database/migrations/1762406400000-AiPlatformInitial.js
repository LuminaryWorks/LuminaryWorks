"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiPlatformInitial1762406400000 = void 0;
class AiPlatformInitial1762406400000 {
    name = "AiPlatformInitial1762406400000";
    async up(queryRunner) {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_connections (
        uid varchar(64) PRIMARY KEY,
        owner_kind varchar(32) NOT NULL,
        owner_uid varchar(128) NOT NULL,
        provider_type varchar(64) NOT NULL,
        display_name varchar(256) NOT NULL,
        base_url varchar(2048),
        model varchar(256) NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        is_default boolean NOT NULL DEFAULT false,
        purpose varchar(128),
        extra jsonb,
        secret_fingerprint varchar(16),
        ciphertext text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS provider_connections_enabled
      ON provider_connections (enabled)`);
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_usage_events (
        id uuid PRIMARY KEY,
        product_code varchar(64) NOT NULL,
        subject_id varchar(128) NOT NULL,
        organization_id varchar(128),
        conversation_uid varchar(128),
        feature varchar(128),
        purpose varchar(32),
        provider_type varchar(64) NOT NULL,
        model varchar(256) NOT NULL,
        prompt_tokens integer NOT NULL DEFAULT 0,
        completion_tokens integer NOT NULL DEFAULT 0,
        audio_input_ms integer,
        audio_output_ms integer,
        latency_ms integer,
        first_token_ms integer,
        cache_hit boolean,
        route_tier varchar(32),
        estimated_cost_minor integer,
        billed varchar(16) NOT NULL,
        status varchar(32),
        trace_id varchar(128),
        at timestamptz NOT NULL,
        wallet_id varchar(128),
        grant_ids jsonb,
        rate_card_id varchar(128),
        rate_card_version varchar(64),
        upstream_cost_micro_usd bigint,
        charged_micro bigint,
        route_id varchar(128),
        attempt_index integer,
        partial boolean,
        surface varchar(16),
        api_key_id varchar(128)
      )`);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ai_usage_events_subject_at
      ON ai_usage_events (subject_id, at)`);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ai_usage_events_product
      ON ai_usage_events (product_code)`);
    }
    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE IF EXISTS ai_usage_events`);
        await queryRunner.query(`DROP TABLE IF EXISTS provider_connections`);
    }
}
exports.AiPlatformInitial1762406400000 = AiPlatformInitial1762406400000;
