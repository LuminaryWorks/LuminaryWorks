import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import type {
  BillingInterval,
  BillingMarket,
  OfferingPlanCode,
} from "../../common/catalog-pricing";
import { CatalogRevisionEntity } from "./catalog-revision.entity";

@Entity({ name: "offerings" })
@Unique(["revisionId", "sku"])
export class OfferingEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  sku!: string;

  @Index()
  @Column({ name: "product_code", type: "varchar", length: 64 })
  productCode!: string;

  @Column({ name: "plan_code", type: "varchar", length: 32 })
  planCode!: OfferingPlanCode;

  @Column({ name: "billing_interval", type: "varchar", length: 16 })
  interval!: BillingInterval;

  @Column({ type: "varchar", length: 8 })
  currency!: string;

  @Column({ name: "amount_minor", type: "int" })
  amountMinor!: number;

  @Column({ type: "varchar", length: 16 })
  market!: BillingMarket;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Index()
  @Column({ name: "catalog_revision_id", type: "uuid" })
  revisionId!: string;

  @ManyToOne(
    () => CatalogRevisionEntity,
    (revision) => revision.offerings,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "catalog_revision_id" })
  revision!: CatalogRevisionEntity;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
