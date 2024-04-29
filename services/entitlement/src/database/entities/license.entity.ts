import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/** License metadata — Ed25519 signed private-deployment grants; never bypasses Casbin. */
@Entity({ name: "licenses" })
export class LicenseEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ name: "license_id", type: "varchar", length: 128 })
  licenseId!: string;

  @Index()
  @Column({ name: "deployment_id", type: "varchar", length: 128 })
  deploymentId!: string;

  @Column({ type: "varchar", length: 64 })
  kid!: string;

  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  signature!: string | null;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ name: "offline_grace_days", type: "int", default: 0 })
  offlineGraceDays!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({ name: "activated_at", type: "timestamptz", nullable: true })
  activatedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
