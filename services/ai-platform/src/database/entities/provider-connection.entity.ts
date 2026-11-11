import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type ConnectionOwnerKind = "user" | "space" | "organization" | "deployment";

@Entity({ name: "provider_connections" })
export class ProviderConnectionEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  uid!: string;

  @Column({ name: "owner_kind", type: "varchar", length: 32 })
  ownerKind!: ConnectionOwnerKind;

  @Column({ name: "owner_uid", type: "varchar", length: 128 })
  ownerUid!: string;

  /** Optional product tag for multi-product shared vault listing (e.g. dataluminary). */
  @Column({ name: "product_code", type: "varchar", length: 64, nullable: true })
  productCode!: string | null;

  @Column({ name: "provider_type", type: "varchar", length: 64 })
  providerType!: string;

  @Column({ name: "display_name", type: "varchar", length: 256 })
  displayName!: string;

  @Column({ name: "base_url", type: "varchar", length: 2048, nullable: true })
  baseUrl!: string | null;

  @Column({ type: "varchar", length: 256 })
  model!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ type: "varchar", length: 128, nullable: true })
  purpose!: string | null;

  @Column({ type: "jsonb", nullable: true })
  extra!: Record<string, string> | null;

  @Column({ name: "secret_fingerprint", type: "varchar", length: 16, nullable: true })
  secretFingerprint!: string | null;

  @Column({ type: "text", nullable: true })
  ciphertext!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
