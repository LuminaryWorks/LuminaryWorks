import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

/** Partner redemptions with idempotent redemptionId. */
@Entity({ name: "redemptions" })
@Unique(["redemptionId"])
export class RedemptionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ name: "redemption_id", type: "varchar", length: 128 })
  redemptionId!: string;

  @Index()
  @Column({ name: "partner_id", type: "uuid" })
  partnerId!: string;

  @Column({ name: "benefit_id", type: "uuid", nullable: true })
  benefitId!: string | null;

  @Column({ name: "logto_sub", type: "varchar", length: 128, nullable: true })
  logtoSub!: string | null;

  @Column({ name: "product_code", type: "varchar", length: 64, nullable: true })
  productCode!: string | null;

  @Column({ type: "varchar", length: 32, default: "active" })
  status!: "active" | "revoked" | "expired";

  @Column({ name: "grant_id", type: "uuid", nullable: true })
  grantId!: string | null;

  @Column({ name: "subscription_id", type: "uuid", nullable: true })
  subscriptionId!: string | null;

  @Column({ name: "starts_at", type: "timestamptz", nullable: true })
  startsAt!: Date | null;

  @Column({ name: "ends_at", type: "timestamptz", nullable: true })
  endsAt!: Date | null;

  @Column({ type: "jsonb", default: {} })
  payload!: Record<string, unknown>;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
