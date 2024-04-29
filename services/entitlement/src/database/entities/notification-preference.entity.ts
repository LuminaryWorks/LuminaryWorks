import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

/** Per-user notification channel preferences for trial / subscription events. */
@Entity({ name: "notification_preferences" })
@Unique(["logtoSub"])
export class NotificationPreferenceEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ name: "logto_sub", type: "varchar", length: 128 })
  logtoSub!: string;

  @Column({ name: "email_enabled", type: "boolean", default: true })
  emailEnabled!: boolean;

  @Column({ name: "in_app_enabled", type: "boolean", default: true })
  inAppEnabled!: boolean;

  @Column({ name: "push_enabled", type: "boolean", default: true })
  pushEnabled!: boolean;

  /** Optional contact email override for entitlement notices. */
  @Column({ name: "email_address", type: "varchar", length: 320, nullable: true })
  emailAddress!: string | null;

  /** Opaque push device tokens / topic refs — product-owned. */
  @Column({ name: "push_tokens", type: "jsonb", default: [] })
  pushTokens!: string[];

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
