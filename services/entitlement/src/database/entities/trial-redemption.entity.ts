import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

/** One-time ToC trial redemptions — unique per (logto_sub, product_code). */
@Entity({ name: "trial_redemptions" })
@Unique(["logtoSub", "productCode"])
export class TrialRedemptionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "logto_sub", type: "varchar", length: 128 })
  logtoSub!: string;

  @Column({ name: "product_code", type: "varchar", length: 64 })
  productCode!: string;

  @Column({ name: "subscription_id", type: "uuid" })
  subscriptionId!: string;

  @Column({ name: "starts_at", type: "timestamptz" })
  startsAt!: Date;

  @Column({ name: "ends_at", type: "timestamptz" })
  endsAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
