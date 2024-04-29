import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "webhook_events" })
export class WebhookEventEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  provider!: string;

  @Column({ name: "event_id", type: "varchar", length: 128, nullable: true })
  eventId!: string | null;

  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: "varchar", length: 32, default: "received" })
  status!: "received" | "processed" | "ignored" | "failed";

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
