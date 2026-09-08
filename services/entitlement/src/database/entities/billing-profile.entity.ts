import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import type { SubjectKind } from "../../common/constants";

@Entity({ name: "billing_profiles" })
@Unique("UQ_billing_profiles_subject", ["subjectKind", "subjectId"])
export class BillingProfileEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ name: "subject_kind", type: "varchar", length: 32 })
  subjectKind!: SubjectKind;

  @Index()
  @Column({ name: "subject_id", type: "varchar", length: 128 })
  subjectId!: string;

  @Column({ type: "varchar", length: 8 })
  country!: string;

  @Column({ type: "varchar", length: 32, default: "user" })
  source!: "user" | "admin" | "geo";

  @Column({ type: "boolean", default: false })
  locked!: boolean;

  @Column({ name: "locked_at", type: "timestamptz", nullable: true })
  lockedAt!: Date | null;

  @Column({ name: "locked_reason", type: "varchar", length: 256, nullable: true })
  lockedReason!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
