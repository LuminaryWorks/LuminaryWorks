import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

export const TRIAL_CLEANUP_JOB_STATUSES = [
  "pending",
  "processing",
  "delivered",
  "acked",
  "canceled",
  "failed",
  "dead",
] as const;
export type TrialCleanupJobStatus = (typeof TRIAL_CLEANUP_JOB_STATUSES)[number];

/** Persist Trial physical-cleanup work scheduled at endsAt; delivery is signed trial.purge. */
@Entity({ name: "trial_cleanup_jobs" })
@Unique("UQ_trial_cleanup_jobs_redemption", ["trialRedemptionId"])
export class TrialCleanupJobEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "trial_redemption_id", type: "uuid" })
  trialRedemptionId!: string;

  @Column({ name: "subscription_id", type: "uuid" })
  subscriptionId!: string;

  @Index()
  @Column({ name: "logto_sub", type: "varchar", length: 128 })
  logtoSub!: string;

  @Index()
  @Column({ name: "product_code", type: "varchar", length: 64 })
  productCode!: string;

  @Column({ name: "policy_version", type: "varchar", length: 64 })
  policyVersion!: string;

  @Column({ name: "starts_at", type: "timestamptz" })
  startsAt!: Date;

  @Column({ name: "ends_at", type: "timestamptz" })
  endsAt!: Date;

  @Index()
  @Column({ name: "scheduled_for", type: "timestamptz" })
  scheduledFor!: Date;

  @Index()
  @Column({ type: "varchar", length: 32, default: "pending" })
  status!: TrialCleanupJobStatus;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @Column({ name: "delivered_at", type: "timestamptz", nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: "acked_at", type: "timestamptz", nullable: true })
  ackedAt!: Date | null;

  @Column({ name: "ack_payload", type: "jsonb", nullable: true })
  ackPayload!: Record<string, unknown> | null;

  @Column({ name: "outbox_event_id", type: "uuid", nullable: true })
  outboxEventId!: string | null;

  @Column({ name: "organization_id", type: "varchar", length: 128, nullable: true })
  organizationId!: string | null;

  @Column({ name: "deployment_id", type: "varchar", length: 128, nullable: true })
  deploymentId!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
