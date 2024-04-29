import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { PlanCode, SubjectKind } from "../../common/constants";

export type OrderStatus = "pending" | "paid" | "failed" | "canceled" | "refunded";

@Entity({ name: "orders" })
export class OrderEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ name: "subject_kind", type: "varchar", length: 32 })
  subjectKind!: SubjectKind;

  @Index()
  @Column({ name: "subject_id", type: "varchar", length: 128 })
  subjectId!: string;

  @Column({ name: "product_code", type: "varchar", length: 64, nullable: true })
  productCode!: string | null;

  @Column({ name: "plan_code", type: "varchar", length: 32, nullable: true })
  planCode!: PlanCode | null;

  @Column({ name: "bundle_sku", type: "varchar", length: 64, nullable: true })
  bundleSku!: string | null;

  @Column({ type: "varchar", length: 32, default: "pending" })
  status!: OrderStatus;

  @Column({ name: "amount_cents", type: "int", default: 0 })
  amountCents!: number;

  @Column({ type: "varchar", length: 8, default: "USD" })
  currency!: string;

  @Column({
    name: "payment_provider",
    type: "varchar",
    length: 64,
    default: "mock",
  })
  paymentProvider!: string;

  @Column({
    name: "provider_ref",
    type: "varchar",
    length: 128,
    nullable: true,
  })
  providerRef!: string | null;

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
