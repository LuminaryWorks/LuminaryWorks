import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { PaymentProviderConfigEntity } from "./payment-provider-config.entity";

@Entity({ name: "provider_webhook_events" })
@Unique("UQ_provider_webhook_events_provider_config_event", ["provider", "configId", "eventId"])
export class ProviderWebhookEventEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  provider!: string;

  @Index()
  @Column({ name: "config_id", type: "uuid" })
  configId!: string;

  @ManyToOne(() => PaymentProviderConfigEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "config_id" })
  config!: PaymentProviderConfigEntity;

  @Column({ name: "event_id", type: "varchar", length: 128 })
  eventId!: string;

  @Column({ name: "raw_body_sha256", type: "varchar", length: 64 })
  rawBodySha256!: string;

  @Column({ type: "jsonb", default: {} })
  payload!: Record<string, unknown>;

  @Column({ type: "varchar", length: 32, default: "received" })
  status!: "received" | "processed" | "ignored" | "duplicate" | "failed";

  @Column({ name: "order_id", type: "uuid", nullable: true })
  orderId!: string | null;

  @Column({ name: "attempt_id", type: "uuid", nullable: true })
  attemptId!: string | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
