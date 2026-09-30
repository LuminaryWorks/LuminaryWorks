import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type EmailMessageStatus = "pending" | "sent" | "unknown" | "failed";

@Entity({ name: "email_messages" })
export class EmailMessageEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ name: "idempotency_key", type: "varchar", length: 64 })
  idempotencyKey!: string;

  @Column({ name: "usage_type", type: "varchar", length: 64 })
  usageType!: string;

  @Column({ name: "to_address", type: "varchar", length: 320 })
  toAddress!: string;

  @Column({ type: "varchar", length: 16 })
  status!: EmailMessageStatus;

  @Column({ name: "provider_id", type: "varchar", length: 128, nullable: true })
  providerId!: string | null;

  @Column({ name: "provider_message_id", type: "varchar", length: 256, nullable: true })
  providerMessageId!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
