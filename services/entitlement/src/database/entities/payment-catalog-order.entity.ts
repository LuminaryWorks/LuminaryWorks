import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "payment_catalog_orders" })
export class PaymentCatalogOrderEntity {
  @PrimaryColumn({ name: "scope_key", type: "varchar", length: 160 })
  scopeKey!: string;

  @Column({ name: "provider_ids", type: "jsonb", default: [] })
  providerIds!: string[];

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
