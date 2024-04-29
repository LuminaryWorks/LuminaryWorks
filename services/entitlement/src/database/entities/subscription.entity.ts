import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { PlanCode, SubjectKind, SubscriptionStatus } from "../../common/constants";

@Entity({ name: "subscriptions" })
export class SubscriptionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ name: "subject_kind", type: "varchar", length: 32 })
  subjectKind!: SubjectKind;

  @Index()
  @Column({ name: "subject_id", type: "varchar", length: 128 })
  subjectId!: string;

  @Index()
  @Column({ name: "product_code", type: "varchar", length: 64 })
  productCode!: string;

  @Column({ name: "plan_code", type: "varchar", length: 32 })
  planCode!: PlanCode;

  @Index()
  @Column({ type: "varchar", length: 32, default: "active" })
  status!: SubscriptionStatus;

  @Column({ name: "starts_at", type: "timestamptz" })
  startsAt!: Date;

  @Column({ name: "ends_at", type: "timestamptz", nullable: true })
  endsAt!: Date | null;

  @Column({ type: "varchar", length: 64 })
  source!: string;

  @Column({ name: "source_ref", type: "varchar", length: 128, nullable: true })
  sourceRef!: string | null;

  @Column({
    name: "organization_id",
    type: "varchar",
    length: 128,
    nullable: true,
  })
  organizationId!: string | null;

  @Column({ name: "canceled_at", type: "timestamptz", nullable: true })
  canceledAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
