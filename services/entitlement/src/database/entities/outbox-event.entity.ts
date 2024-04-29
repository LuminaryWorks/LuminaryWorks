import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Transactional outbox for notifications / partner webhooks.
 * Event types: trial.expiring, trial.expired, subscription.*, grant.*, partner.*, order.*
 */
@Entity({ name: "outbox_events" })
export class OutboxEventEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ name: "event_type", type: "varchar", length: 64 })
  eventType!: string;

  /** Dedup key e.g. user+product+eventType+scheduledFor */
  @Index({ unique: true })
  @Column({ name: "dedupe_key", type: "varchar", length: 256 })
  dedupeKey!: string;

  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: "varchar", length: 32, default: "pending" })
  status!: "pending" | "processing" | "sent" | "failed" | "canceled" | "dead";

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ name: "max_attempts", type: "int", default: 8 })
  maxAttempts!: number;

  @Column({ name: "next_attempt_at", type: "timestamptz", nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: "scheduled_for", type: "timestamptz", nullable: true })
  scheduledFor!: Date | null;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @Column({ name: "dead_lettered_at", type: "timestamptz", nullable: true })
  deadLetteredAt!: Date | null;

  /** Exclusive lease end — expired leases are reclaimable via SKIP LOCKED. */
  @Index()
  @Column({ name: "locked_until", type: "timestamptz", nullable: true })
  lockedUntil!: Date | null;

  @Column({ name: "locked_by", type: "varchar", length: 128, nullable: true })
  lockedBy!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
