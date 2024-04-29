import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import type { FeatureEffect, QuotaMerge } from "../../common/constants";
import { FeatureEntity } from "./feature.entity";
import { PlanEntity } from "./plan.entity";

@Entity({ name: "plan_features" })
@Unique(["planId", "featureId"])
export class PlanFeatureEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "plan_id", type: "uuid" })
  planId!: string;

  @ManyToOne(
    () => PlanEntity,
    (p) => p.planFeatures,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "plan_id" })
  plan!: PlanEntity;

  @Column({ name: "feature_id", type: "uuid" })
  featureId!: string;

  @ManyToOne(() => FeatureEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "feature_id" })
  feature!: FeatureEntity;

  @Column({ type: "varchar", length: 8, default: "allow" })
  effect!: FeatureEffect;

  @Column({ name: "limit_value", type: "bigint", nullable: true })
  limitValue!: string | null;

  @Column({ name: "quota_merge", type: "varchar", length: 8, nullable: true })
  quotaMerge!: QuotaMerge | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
