import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { TrialPolicy } from "../../common/constants";
import { FeatureEntity } from "./feature.entity";
import { PlanEntity } from "./plan.entity";

@Entity({ name: "products" })
export class ProductEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 64 })
  code!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({
    name: "trial_policy",
    type: "varchar",
    length: 32,
    default: "standard_7d",
  })
  trialPolicy!: TrialPolicy;

  @OneToMany(
    () => FeatureEntity,
    (f) => f.product,
  )
  features!: FeatureEntity[];

  @OneToMany(
    () => PlanEntity,
    (p) => p.product,
  )
  plans!: PlanEntity[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
