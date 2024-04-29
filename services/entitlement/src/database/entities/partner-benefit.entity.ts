import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { PlanCode } from "../../common/constants";
import { PartnerEntity } from "./partner.entity";

@Entity({ name: "partner_benefits" })
export class PartnerBenefitEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "partner_id", type: "uuid" })
  partnerId!: string;

  @ManyToOne(() => PartnerEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "partner_id" })
  partner!: PartnerEntity;

  @Index()
  @Column({ name: "product_code", type: "varchar", length: 64 })
  productCode!: string;

  @Column({ name: "plan_code", type: "varchar", length: 32 })
  planCode!: PlanCode;

  @Column({ name: "duration_days", type: "int", nullable: true })
  durationDays!: number | null;

  @Column({ type: "jsonb", default: {} })
  features!: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
