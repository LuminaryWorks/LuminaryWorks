import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import type { PlanCode } from "../../common/constants";
import { PlanFeatureEntity } from "./plan-feature.entity";
import { ProductEntity } from "./product.entity";

@Entity({ name: "plans" })
@Unique(["productId", "code"])
export class PlanEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "product_id", type: "uuid" })
  productId!: string;

  @ManyToOne(
    () => ProductEntity,
    (p) => p.plans,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "product_id" })
  product!: ProductEntity;

  @Index()
  @Column({ type: "varchar", length: 32 })
  code!: PlanCode;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "int", default: 0 })
  rank!: number;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @OneToMany(
    () => PlanFeatureEntity,
    (pf) => pf.plan,
  )
  planFeatures!: PlanFeatureEntity[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
