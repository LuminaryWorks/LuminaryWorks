import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import type { QuotaMerge, QuotaPeriod } from "../../common/constants";
import { ProductEntity } from "./product.entity";

@Entity({ name: "features" })
@Unique(["productId", "code"])
export class FeatureEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "product_id", type: "uuid" })
  productId!: string;

  @ManyToOne(
    () => ProductEntity,
    (p) => p.features,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "product_id" })
  product!: ProductEntity;

  @Index()
  @Column({ type: "varchar", length: 128 })
  code!: string;

  @Column({ type: "varchar", length: 256 })
  name!: string;

  @Column({ type: "varchar", length: 16, default: "bool" })
  kind!: "bool" | "quota";

  @Column({ name: "quota_period", type: "varchar", length: 32, nullable: true })
  quotaPeriod!: QuotaPeriod | null;

  @Column({ name: "quota_merge", type: "varchar", length: 8, default: "max" })
  quotaMerge!: QuotaMerge;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
