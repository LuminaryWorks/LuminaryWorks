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
import type { PaymentAttemptStatus } from "../../common/payment-providers";
import { OrderEntity } from "./order.entity";
import { PaymentProviderConfigEntity } from "./payment-provider-config.entity";

@Entity({ name: "payment_attempts" })
export class PaymentAttemptEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ name: "order_id", type: "uuid" })
  orderId!: string;

  @ManyToOne(() => OrderEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order!: OrderEntity;

  @Column({ name: "config_id", type: "uuid", nullable: true })
  configId!: string | null;

  @ManyToOne(() => PaymentProviderConfigEntity, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "config_id" })
  config!: PaymentProviderConfigEntity | null;

  @Index()
  @Column({ type: "varchar", length: 64 })
  provider!: string;

  @Column({ name: "provider_ref", type: "varchar", length: 128, nullable: true })
  providerRef!: string | null;

  @Column({ type: "varchar", length: 32, default: "created" })
  status!: PaymentAttemptStatus;

  @Column({ name: "amount_cents", type: "int" })
  amountCents!: number;

  @Column({ type: "varchar", length: 8 })
  currency!: string;

  @Column({ name: "merchant_id", type: "varchar", length: 128, nullable: true })
  merchantId!: string | null;

  @Column({ name: "checkout_url", type: "varchar", length: 2048, nullable: true })
  checkoutUrl!: string | null;

  @Column({ name: "qr_payload", type: "text", nullable: true })
  qrPayload!: string | null;

  @Column({ type: "jsonb", nullable: true })
  action!: Record<string, unknown> | null;

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
