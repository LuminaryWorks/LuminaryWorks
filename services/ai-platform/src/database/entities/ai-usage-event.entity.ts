import { Column, Entity, Index, PrimaryColumn } from "typeorm";

const micro = {
  to: (value: number | null): string | null => (value == null ? null : String(Math.trunc(value))),
  from: (value: string | null): number | null => (value == null ? null : Number(value)),
};

@Entity({ name: "ai_usage_events" })
export class AiUsageEventEntity {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Index()
  @Column({ name: "product_code", type: "varchar", length: 64 })
  productCode!: string;

  @Index()
  @Column({ name: "subject_id", type: "varchar", length: 128 })
  subjectId!: string;

  @Column({ name: "organization_id", type: "varchar", length: 128, nullable: true })
  organizationId!: string | null;

  @Column({ name: "conversation_uid", type: "varchar", length: 128, nullable: true })
  conversationUid!: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  feature!: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  purpose!: string | null;

  @Column({ name: "provider_type", type: "varchar", length: 64 })
  providerType!: string;

  @Column({ type: "varchar", length: 256 })
  model!: string;

  @Column({ name: "prompt_tokens", type: "integer", default: 0 })
  promptTokens!: number;

  @Column({ name: "completion_tokens", type: "integer", default: 0 })
  completionTokens!: number;

  @Column({ name: "audio_input_ms", type: "integer", nullable: true })
  audioInputMs!: number | null;

  @Column({ name: "audio_output_ms", type: "integer", nullable: true })
  audioOutputMs!: number | null;

  @Column({ name: "latency_ms", type: "integer", nullable: true })
  latencyMs!: number | null;

  @Column({ name: "first_token_ms", type: "integer", nullable: true })
  firstTokenMs!: number | null;

  @Column({ name: "cache_hit", type: "boolean", nullable: true })
  cacheHit!: boolean | null;

  @Column({ name: "route_tier", type: "varchar", length: 32, nullable: true })
  routeTier!: string | null;

  @Column({ name: "estimated_cost_minor", type: "integer", nullable: true })
  estimatedCostMinor!: number | null;

  @Column({ type: "varchar", length: 16 })
  billed!: string;

  @Column({ type: "varchar", length: 32, nullable: true })
  status!: string | null;

  @Column({ name: "trace_id", type: "varchar", length: 128, nullable: true })
  traceId!: string | null;

  @Index()
  @Column({ type: "timestamptz" })
  at!: Date;

  @Column({ name: "wallet_id", type: "varchar", length: 128, nullable: true })
  walletId!: string | null;

  @Column({ name: "grant_ids", type: "jsonb", nullable: true })
  grantIds!: string[] | null;

  @Column({ name: "rate_card_id", type: "varchar", length: 128, nullable: true })
  rateCardId!: string | null;

  @Column({ name: "rate_card_version", type: "varchar", length: 64, nullable: true })
  rateCardVersion!: string | null;

  @Column({
    name: "upstream_cost_micro_usd",
    type: "bigint",
    nullable: true,
    transformer: micro,
  })
  upstreamCostMicroUsd!: number | null;

  @Column({ name: "charged_micro", type: "bigint", nullable: true, transformer: micro })
  chargedMicro!: number | null;

  @Column({ name: "route_id", type: "varchar", length: 128, nullable: true })
  routeId!: string | null;

  @Column({ name: "attempt_index", type: "integer", nullable: true })
  attemptIndex!: number | null;

  @Column({ type: "boolean", nullable: true })
  partial!: boolean | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  surface!: string | null;

  @Column({ name: "api_key_id", type: "varchar", length: 128, nullable: true })
  apiKeyId!: string | null;
}
