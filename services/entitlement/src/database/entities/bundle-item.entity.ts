import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { PlanCode } from "../../common/constants";
import { BundleEntity } from "./bundle.entity";

@Entity({ name: "bundle_items" })
export class BundleItemEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "bundle_id", type: "uuid" })
  bundleId!: string;

  @ManyToOne(
    () => BundleEntity,
    (b) => b.items,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "bundle_id" })
  bundle!: BundleEntity;

  @Column({ name: "product_code", type: "varchar", length: 64 })
  productCode!: string;

  @Column({ name: "plan_code", type: "varchar", length: 32 })
  planCode!: PlanCode;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
