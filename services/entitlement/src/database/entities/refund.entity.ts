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
import type { RefundStatus } from "../../common/payment-providers";
import { OrderEntity } from "./order.entity";
import { PaymentAttemptEntity } from "./payment-attempt.entity";

@Entity({ name: "refunds" })
export class RefundEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ name: "order_id", type: "uuid" })
  orderId!: string;

  @ManyToOne(() => OrderEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order!: OrderEntity;

  @Column({ name: "attempt_id", type: "uuid", nullable: true })
  attemptId!: string | null;

  @ManyToOne(() => PaymentAttemptEntity, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "attempt_id" })
  attempt!: PaymentAttemptEntity | null;

  @Index({ unique: true })
  @Column({ name: "idempotency_key", type: "varchar", length: 128 })
  idempotencyKey!: string;

  @Column({ name: "amount_cents", type: "int" })
  amountCents!: number;

  @Column({ type: "varchar", length: 8 })
  currency!: string;

  @Column({ type: "varchar", length: 32, default: "pending" })
  status!: RefundStatus;

  @Column({ name: "provider_ref", type: "varchar", length: 128, nullable: true })
  providerRef!: string | null;

  @Column({ type: "varchar", length: 128 })
  actor!: string;

  @Column({ type: "varchar", length: 512 })
  reason!: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  ticket!: string | null;

  @Column({ type: "jsonb", default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
