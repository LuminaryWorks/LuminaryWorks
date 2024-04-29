import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from "typeorm";
import type { QuotaPeriod, SubjectKind } from "../../common/constants";

@Entity({ name: "usage_counters" })
@Unique(["subjectKind", "subjectId", "productCode", "featureCode", "periodKey"])
export class UsageCounterEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "subject_kind", type: "varchar", length: 32 })
  subjectKind!: SubjectKind;

  @Column({ name: "subject_id", type: "varchar", length: 128 })
  subjectId!: string;

  @Column({ name: "product_code", type: "varchar", length: 64 })
  productCode!: string;

  @Index()
  @Column({ name: "feature_code", type: "varchar", length: 128 })
  featureCode!: string;

  @Column({ name: "period_key", type: "varchar", length: 64 })
  periodKey!: string;

  @Column({ type: "varchar", length: 32 })
  period!: QuotaPeriod;

  @Column({ type: "bigint", default: "0" })
  used!: string;

  @Column({ name: "limit_value", type: "bigint", nullable: true })
  limitValue!: string | null;

  @VersionColumn()
  version!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
