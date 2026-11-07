"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiPlatformWallet1762500000000 = void 0;
class AiPlatformWallet1762500000000 {
    name = "AiPlatformWallet1762500000000";
    async up(queryRunner) {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        wallet_id varchar(64) PRIMARY KEY,
        owner_kind varchar(32) NOT NULL,
        owner_id varchar(128) NOT NULL,
        currency varchar(8) NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT wallets_owner_unique UNIQUE (owner_kind, owner_id),
        CONSTRAINT wallets_owner_kind_chk CHECK (owner_kind IN ('user', 'organization')),
        CONSTRAINT wallets_currency_chk CHECK (currency IN ('USD', 'CNY')),
        CONSTRAINT wallets_status_chk CHECK (status IN ('active', 'frozen', 'closed'))
      )`);
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS credit_grants (
        grant_id varchar(64) PRIMARY KEY,
        wallet_id varchar(64) NOT NULL REFERENCES wallets (wallet_id),
        kind varchar(32) NOT NULL,
        amount_micro bigint NOT NULL,
        remaining_micro bigint NOT NULL,
        expires_at timestamptz,
        restrict_product_codes jsonb,
        restrict_capabilities jsonb,
        source_type varchar(32) NOT NULL,
        source_id varchar(128) NOT NULL,
        revoked_micro bigint NOT NULL DEFAULT 0,
        revoke_shortfall_micro bigint NOT NULL DEFAULT 0,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT credit_grants_source_unique UNIQUE (source_type, source_id),
        CONSTRAINT credit_grants_kind_chk CHECK (kind IN ('topup', 'subscription', 'promo', 'trial', 'refund_reversal')),
        CONSTRAINT credit_grants_source_chk CHECK (source_type IN ('order', 'subscription_period', 'admin', 'promo')),
        CONSTRAINT credit_grants_amount_chk CHECK (amount_micro > 0 AND remaining_micro >= 0 AND remaining_micro <= amount_micro),
        CONSTRAINT credit_grants_revoked_chk CHECK (
          revoked_micro >= 0 AND revoked_micro <= amount_micro AND revoke_shortfall_micro >= 0
        )
      )`);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS credit_grants_wallet ON credit_grants (wallet_id)`);
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS credit_holds (
        hold_id varchar(64) PRIMARY KEY,
        wallet_id varchar(64) NOT NULL REFERENCES wallets (wallet_id),
        request_id varchar(128) NOT NULL,
        amount_micro bigint NOT NULL,
        status varchar(16) NOT NULL,
        expires_at timestamptz NOT NULL,
        product_code varchar(64),
        capability varchar(64),
        settled_micro bigint,
        overrun_micro bigint,
        upstream_cost_micro_usd bigint,
        rate_card_id varchar(128),
        rate_card_version integer,
        partial boolean,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT credit_holds_request_unique UNIQUE (request_id),
        CONSTRAINT credit_holds_status_chk CHECK (status IN ('pending', 'settled', 'released', 'expired')),
        CONSTRAINT credit_holds_amount_chk CHECK (amount_micro >= 0)
      )`);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS credit_holds_wallet_status ON credit_holds (wallet_id, status)`);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS credit_holds_expiry ON credit_holds (status, expires_at)`);
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS credit_hold_allocations (
        allocation_id varchar(64) PRIMARY KEY,
        hold_id varchar(64) NOT NULL REFERENCES credit_holds (hold_id),
        grant_id varchar(64) NOT NULL REFERENCES credit_grants (grant_id),
        ordinal integer NOT NULL,
        amount_micro bigint NOT NULL,
        released_micro bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT credit_hold_allocations_amount_chk CHECK (amount_micro > 0 AND released_micro >= 0 AND released_micro <= amount_micro)
      )`);
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        entry_id varchar(64) PRIMARY KEY,
        wallet_id varchar(64) NOT NULL REFERENCES wallets (wallet_id),
        grant_id varchar(64) REFERENCES credit_grants (grant_id),
        hold_id varchar(64) REFERENCES credit_holds (hold_id),
        kind varchar(32) NOT NULL,
        amount_micro bigint NOT NULL,
        balance_after_micro bigint,
        request_id varchar(128),
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ledger_entries_kind_chk CHECK (
          kind IN ('grant', 'reserve', 'settle', 'release', 'expire', 'refund_reversal', 'overrun')
        ),
        CONSTRAINT ledger_entries_amount_chk CHECK (amount_micro >= 0)
      )`);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ledger_entries_wallet_created ON ledger_entries (wallet_id, created_at)`);
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS rate_cards (
        rate_card_id varchar(128) NOT NULL,
        version integer NOT NULL,
        effective_from timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (rate_card_id, version),
        CONSTRAINT rate_cards_version_chk CHECK (version > 0)
      )`);
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS rate_card_lines (
        line_id varchar(64) PRIMARY KEY,
        rate_card_id varchar(128) NOT NULL,
        version integer NOT NULL,
        capability varchar(64) NOT NULL,
        provider_type varchar(64) NOT NULL,
        model varchar(256) NOT NULL,
        unit varchar(64) NOT NULL,
        upstream_cost_micro_usd bigint NOT NULL,
        markup_bps integer NOT NULL,
        fixed_fee_micro bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT rate_card_lines_card_fk FOREIGN KEY (rate_card_id, version)
          REFERENCES rate_cards (rate_card_id, version),
        CONSTRAINT rate_card_lines_unit_chk CHECK (unit IN (
          '1k_input_tokens', '1k_output_tokens', '1k_cached_input_tokens',
          'audio_second_in', 'audio_second_out', 'image', 'assessment', 'video_second'
        )),
        CONSTRAINT rate_card_lines_money_chk CHECK (
          upstream_cost_micro_usd >= 0 AND markup_bps >= 0 AND fixed_fee_micro >= 0
        )
      )`);
        await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ai_platform_reject_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
      END;
      $$`);
        await queryRunner.query(`
      CREATE TRIGGER ledger_entries_append_only
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION ai_platform_reject_mutation()`);
        await queryRunner.query(`
      CREATE TRIGGER rate_cards_append_only
      BEFORE UPDATE OR DELETE ON rate_cards
      FOR EACH ROW
      EXECUTE FUNCTION ai_platform_reject_mutation()`);
        await queryRunner.query(`
      CREATE TRIGGER rate_card_lines_append_only
      BEFORE UPDATE OR DELETE ON rate_card_lines
      FOR EACH ROW
      EXECUTE FUNCTION ai_platform_reject_mutation()`);
    }
    async down(queryRunner) {
        await queryRunner.query(`DROP TRIGGER IF EXISTS rate_card_lines_append_only ON rate_card_lines`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS rate_cards_append_only ON rate_cards`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS ai_platform_reject_mutation()`);
        await queryRunner.query(`DROP TABLE IF EXISTS rate_card_lines`);
        await queryRunner.query(`DROP TABLE IF EXISTS rate_cards`);
        await queryRunner.query(`DROP TABLE IF EXISTS ledger_entries`);
        await queryRunner.query(`DROP TABLE IF EXISTS credit_hold_allocations`);
        await queryRunner.query(`DROP TABLE IF EXISTS credit_holds`);
        await queryRunner.query(`DROP TABLE IF EXISTS credit_grants`);
        await queryRunner.query(`DROP TABLE IF EXISTS wallets`);
    }
}
exports.AiPlatformWallet1762500000000 = AiPlatformWallet1762500000000;
