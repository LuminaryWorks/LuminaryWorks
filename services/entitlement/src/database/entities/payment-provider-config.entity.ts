import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type {
  PaymentConfigStatus,
  PaymentEnvironment,
  ProviderCapabilities,
  ProviderId,
} from "../../common/payment-providers";

@Entity({ name: "payment_provider_configs" })
export class PaymentProviderConfigEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ name: "provider_id", type: "varchar", length: 64 })
  providerId!: ProviderId;

  @Column({ type: "varchar", length: 16, default: "sandbox" })
  environment!: PaymentEnvironment;

  @Column({ type: "boolean", default: false })
  enabled!: boolean;

  @Column({ type: "varchar", length: 32, default: "disabled" })
  status!: PaymentConfigStatus;

  @Column({ name: "market_scopes", type: "jsonb", default: [] })
  marketScopes!: string[];

  @Column({ type: "jsonb", default: [] })
  currencies!: string[];

  @Column({ type: "int", default: 100 })
  priority!: number;

  @Column({ type: "jsonb", default: {} })
  capabilities!: ProviderCapabilities;

  @Column({ name: "merchant_id", type: "varchar", length: 128, nullable: true })
  merchantId!: string | null;

  @Column({ name: "credentials_ciphertext", type: "text", default: "" })
  credentialsCiphertext!: string;

  @Column({ name: "previous_credentials_ciphertext", type: "text", nullable: true })
  previousCredentialsCiphertext!: string | null;

  @Column({ name: "previous_retiring_until", type: "timestamptz", nullable: true })
  previousRetiringUntil!: Date | null;

  @Column({ name: "credential_fingerprint", type: "varchar", length: 64, default: "" })
  credentialFingerprint!: string;

  @Column({ name: "credential_last_four", type: "varchar", length: 8, default: "****" })
  credentialLastFour!: string;

  @Column({ name: "key_fingerprint", type: "varchar", length: 32, default: "" })
  keyFingerprint!: string;

  @Column({ name: "rotated_at", type: "timestamptz", nullable: true })
  rotatedAt!: Date | null;

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
