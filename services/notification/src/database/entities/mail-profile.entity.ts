import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type MailProfileScope = "platform" | "organization" | "deployment";
export type MailProviderKind = "brevo" | "resend" | "smtp" | "mailgun";
export type MailUsage = "auth" | "product";

@Entity({ name: "mail_profiles" })
export class MailProfileEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 32 })
  scope!: MailProfileScope;

  @Column({ name: "organization_id", type: "varchar", length: 128, nullable: true })
  organizationId!: string | null;

  @Column({ name: "from_address", type: "varchar", length: 320 })
  fromAddress!: string;

  @Column({ name: "from_name", type: "varchar", length: 128, nullable: true })
  fromName!: string | null;

  @Column({ type: "varchar", length: 16 })
  provider!: MailProviderKind;

  @Column({ name: "credentials_cipher", type: "text" })
  credentialsCipher!: string;

  @Column({ name: "match_domains", type: "jsonb", default: () => "'[]'" })
  matchDomains!: string[];

  @Column({ type: "boolean", default: false })
  verified!: boolean;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "varchar", length: 16, default: "auth" })
  usage!: MailUsage;

  @Column({ type: "int", default: 100 })
  priority!: number;

  @Column({ name: "daily_quota", type: "int", default: 0 })
  dailyQuota!: number;

  @Column({ name: "monthly_quota", type: "int", default: 0 })
  monthlyQuota!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
