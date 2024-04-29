import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { PlanCode, SubjectKind } from "../../common/constants";

@Entity({ name: "grants" })
export class GrantEntity {
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

  @Column({ name: "plan_code", type: "varchar", length: 32, nullable: true })
  planCode!: PlanCode | null;

  /** Feature overrides: { [featureCode]: { effect, limitValue? } } */
  @Column({ type: "jsonb", default: {} })
  features!: Record<string, { effect: "allow" | "deny"; limitValue?: number | null }>;

  @Column({ name: "starts_at", type: "timestamptz" })
  startsAt!: Date;

  @Column({ name: "ends_at", type: "timestamptz", nullable: true })
  endsAt!: Date | null;

  @Column({ type: "varchar", length: 64 })
  source!: string;

  @Column({ name: "source_ref", type: "varchar", length: 128, nullable: true })
  sourceRef!: string | null;

  @Column({ type: "boolean", default: false })
  revoked!: boolean;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @Column({
    name: "organization_id",
    type: "varchar",
    length: 128,
    nullable: true,
  })
  organizationId!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
