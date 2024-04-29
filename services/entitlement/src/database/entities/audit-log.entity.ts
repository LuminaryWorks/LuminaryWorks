import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "audit_logs" })
export class AuditLogEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 128 })
  actor!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  action!: string;

  @Column({ name: "resource_type", type: "varchar", length: 64 })
  resourceType!: string;

  @Column({ name: "resource_id", type: "varchar", length: 128, nullable: true })
  resourceId!: string | null;

  @Column({ type: "varchar", length: 256, nullable: true })
  reason!: string | null;

  @Column({ name: "request_id", type: "varchar", length: 128, nullable: true })
  requestId!: string | null;

  @Column({ type: "jsonb", nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
