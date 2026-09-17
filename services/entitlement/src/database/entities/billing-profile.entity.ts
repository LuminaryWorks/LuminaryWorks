import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import type { PayerType } from "../../common/billing-profile";
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

  /** ISO 3166-1 alpha-2. Spec `countryCode` — do not add a duplicate column. */
  @Column({ type: "varchar", length: 8 })
  country!: string;

  @Column({ name: "payer_type", type: "varchar", length: 16, default: "individual" })
  payerType!: PayerType;

  @Column({ name: "company_name", type: "varchar", length: 256, nullable: true })
  companyName!: string | null;

  @Column({ name: "tax_id", type: "varchar", length: 64, nullable: true })
  taxId!: string | null;

  @Column({ name: "address_line1", type: "varchar", length: 256, nullable: true })
  addressLine1!: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  city!: string | null;

  @Column({ name: "postal_code", type: "varchar", length: 32, nullable: true })
  postalCode!: string | null;

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
