import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from "typeorm";
import type { SubjectKind } from "../../common/constants";

@Entity({ name: "resource_allocations" })
@Unique("UQ_resource_allocations_subject_feature_resource", [
  "subjectKind",
  "subjectId",
  "productCode",
  "featureCode",
  "resourceId",
])
@Check(`"amount" >= 0`)
export class ResourceAllocationEntity {
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

  @Column({ name: "resource_id", type: "varchar", length: 512 })
  resourceId!: string;

  @Column({ type: "bigint", default: "0" })
  amount!: string;

  @Column({ name: "owner_kind", type: "varchar", length: 32, nullable: true })
  ownerKind!: string | null;

  @Column({ name: "owner_id", type: "varchar", length: 128, nullable: true })
  ownerId!: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  source!: string | null;

  @Column({ name: "source_ref", type: "varchar", length: 128, nullable: true })
  sourceRef!: string | null;

  @VersionColumn()
  version!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
