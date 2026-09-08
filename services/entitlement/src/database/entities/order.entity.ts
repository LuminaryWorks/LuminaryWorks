import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { BillingInterval } from "../../common/catalog-pricing";
import type { PlanCode, SubjectKind } from "../../common/constants";
import type { OrderStatus } from "../../common/payment-providers";
import { CatalogRevisionEntity } from "./catalog-revision.entity";
import { OfferingEntity } from "./offering.entity";
import { PaymentProviderConfigEntity } from "./payment-provider-config.entity";

export type { OrderStatus };

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

  @Column({ name: "offering_id", type: "uuid", nullable: true })
  offeringId!: string | null;

  @ManyToOne(() => OfferingEntity, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "offering_id" })
  offering!: OfferingEntity | null;

  @Column({ name: "offering_sku", type: "varchar", length: 64, nullable: true })
  offeringSku!: string | null;

  @Column({ name: "billing_interval", type: "varchar", length: 16, nullable: true })
  interval!: BillingInterval | null;

  @Column({ name: "catalog_revision_id", type: "uuid", nullable: true })
  catalogRevisionId!: string | null;

  @ManyToOne(() => CatalogRevisionEntity, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "catalog_revision_id" })
  catalogRevision!: CatalogRevisionEntity | null;

  @Column({ name: "return_url", type: "varchar", length: 2048, nullable: true })
  returnUrl!: string | null;

  @Column({ type: "varchar", length: 32, default: "created" })
  status!: OrderStatus;

  @Column({ name: "payment_config_id", type: "uuid", nullable: true })
  paymentConfigId!: string | null;

  @ManyToOne(() => PaymentProviderConfigEntity, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "payment_config_id" })
  paymentConfig!: PaymentProviderConfigEntity | null;

  /** Integer minor units (cents/fen). Snapshot of offering.amountMinor. */
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
