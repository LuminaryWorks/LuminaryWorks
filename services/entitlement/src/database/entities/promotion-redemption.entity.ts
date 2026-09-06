import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

@Entity({ name: "promotion_redemptions" })
@Unique(["subjectId", "productCode", "promotionCode"])
export class PromotionRedemptionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "subject_id", type: "varchar", length: 128 })
  subjectId!: string;

  @Column({ name: "product_code", type: "varchar", length: 64 })
  productCode!: string;

  @Column({ name: "promotion_code", type: "varchar", length: 128 })
  promotionCode!: string;

  @Column({ name: "grant_id", type: "uuid" })
  grantId!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
