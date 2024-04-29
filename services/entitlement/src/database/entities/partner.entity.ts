import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/** Generic partner registry — no partner brand names hardcoded in application logic. */
@Entity({ name: "partners" })
export class PartnerEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 64 })
  code!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Index({ unique: true })
  @Column({ name: "client_id", type: "varchar", length: 128, nullable: true })
  clientId!: string | null;

  /** sha256(pepper:client_secret) — plaintext secret never stored. */
  @Column({ name: "client_secret_hash", type: "varchar", length: 128, nullable: true })
  clientSecretHash!: string | null;

  /** HMAC secret for outbound/inbound webhook signatures (kept server-side only). */
  @Column({ name: "webhook_secret", type: "varchar", length: 256, nullable: true })
  webhookSecret!: string | null;

  @Column({ name: "webhook_url", type: "varchar", length: 512, nullable: true })
  webhookUrl!: string | null;

  /** OAuth2-style scopes granted to this partner (e.g. partner:redeem). */
  @Column({ type: "jsonb", default: [] })
  scopes!: string[];

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
