import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

const micro = {
  to: (value: bigint | null | undefined): string | null => (value == null ? null : value.toString()),
  from: (value: string | null): bigint | null => (value == null ? null : BigInt(value)),
};

/** Schema mirror. Ledger mutations go through WalletService inserts only. */
@Entity({ name: "wallets" })
export class WalletEntity {
  @PrimaryColumn({ name: "wallet_id", type: "varchar", length: 64 })
  walletId!: string;

  @Column({ name: "owner_kind", type: "varchar", length: 32 })
  ownerKind!: "user" | "organization";

  @Column({ name: "owner_id", type: "varchar", length: 128 })
  ownerId!: string;

  @Column({ type: "varchar", length: 8 })
  currency!: "USD" | "CNY";

  @Column({ type: "varchar", length: 16 })
  status!: "active" | "frozen" | "closed";

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

@Entity({ name: "credit_grants" })
export class CreditGrantEntity {
  @PrimaryColumn({ name: "grant_id", type: "varchar", length: 64 })
  grantId!: string;

  @Column({ name: "wallet_id", type: "varchar", length: 64 })
  walletId!: string;

  @Column({ type: "varchar", length: 32 })
  kind!: string;

  @Column({ name: "amount_micro", type: "bigint", transformer: micro })
  amountMicro!: bigint;

  @Column({ name: "remaining_micro", type: "bigint", transformer: micro })
  remainingMicro!: bigint;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ name: "restrict_product_codes", type: "jsonb", nullable: true })
  restrictProductCodes!: string[] | null;

  @Column({ name: "restrict_capabilities", type: "jsonb", nullable: true })
  restrictCapabilities!: string[] | null;

  @Column({ name: "source_type", type: "varchar", length: 32 })
  sourceType!: string;

  @Column({ name: "source_id", type: "varchar", length: 128 })
  sourceId!: string;

  @Column({ name: "revoked_micro", type: "bigint", transformer: micro, default: 0 })
  revokedMicro!: bigint;

  @Column({ name: "revoke_shortfall_micro", type: "bigint", transformer: micro, default: 0 })
  revokeShortfallMicro!: bigint;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

@Entity({ name: "credit_holds" })
export class CreditHoldEntity {
  @PrimaryColumn({ name: "hold_id", type: "varchar", length: 64 })
  holdId!: string;

  @Column({ name: "wallet_id", type: "varchar", length: 64 })
  walletId!: string;

  @Column({ name: "request_id", type: "varchar", length: 128 })
  requestId!: string;

  @Column({ name: "amount_micro", type: "bigint", transformer: micro })
  amountMicro!: bigint;

  @Column({ type: "varchar", length: 16 })
  status!: "pending" | "settled" | "released" | "expired";

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

@Entity({ name: "ledger_entries" })
export class LedgerEntryEntity {
  @PrimaryColumn({ name: "entry_id", type: "varchar", length: 64 })
  entryId!: string;

  @Column({ name: "wallet_id", type: "varchar", length: 64 })
  walletId!: string;

  @Column({ name: "grant_id", type: "varchar", length: 64, nullable: true })
  grantId!: string | null;

  @Column({ name: "hold_id", type: "varchar", length: 64, nullable: true })
  holdId!: string | null;

  @Column({ type: "varchar", length: 32 })
  kind!: string;

  @Column({ name: "amount_micro", type: "bigint", transformer: micro })
  amountMicro!: bigint;

  @Column({ name: "balance_after_micro", type: "bigint", transformer: micro, nullable: true })
  balanceAfterMicro!: bigint | null;

  @Column({ name: "request_id", type: "varchar", length: 128, nullable: true })
  requestId!: string | null;

  @Column({ type: "jsonb" })
  meta!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

@Entity({ name: "rate_cards" })
export class RateCardEntity {
  @PrimaryColumn({ name: "rate_card_id", type: "varchar", length: 128 })
  rateCardId!: string;

  @PrimaryColumn({ type: "integer" })
  version!: number;

  @Column({ name: "effective_from", type: "timestamptz" })
  effectiveFrom!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

@Entity({ name: "rate_card_lines" })
export class RateCardLineEntity {
  @PrimaryColumn({ name: "line_id", type: "varchar", length: 64 })
  lineId!: string;

  @Column({ name: "rate_card_id", type: "varchar", length: 128 })
  rateCardId!: string;

  @Column({ type: "integer" })
  version!: number;

  @Column({ type: "varchar", length: 64 })
  capability!: string;

  @Column({ name: "provider_type", type: "varchar", length: 64 })
  providerType!: string;

  @Column({ type: "varchar", length: 256 })
  model!: string;

  @Column({ type: "varchar", length: 64 })
  unit!: string;

  @Column({ name: "upstream_cost_micro_usd", type: "bigint", transformer: micro })
  upstreamCostMicroUsd!: bigint;

  @Column({ name: "markup_bps", type: "integer" })
  markupBps!: number;

  @Column({ name: "fixed_fee_micro", type: "bigint", transformer: micro })
  fixedFeeMicro!: bigint;
}
