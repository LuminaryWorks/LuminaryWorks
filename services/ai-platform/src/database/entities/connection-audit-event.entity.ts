import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

export type ConnectionAuditAction = "create" | "update" | "delete" | "test";

/** Connection lifecycle audit. Never store a secret, ciphertext, or base URL. */
@Entity({ name: "connection_audit_events" })
export class ConnectionAuditEventEntity {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ type: "varchar", length: 16 })
  action!: ConnectionAuditAction;

  @Index()
  @Column({ name: "actor_sub", type: "varchar", length: 128 })
  actorSub!: string;

  @Column({ name: "actor_kind", type: "varchar", length: 16 })
  actorKind!: string;

  @Column({ name: "owner_kind", type: "varchar", length: 32 })
  ownerKind!: string;

  @Column({ name: "owner_uid", type: "varchar", length: 128 })
  ownerUid!: string;

  @Index()
  @Column({ name: "connection_uid", type: "varchar", length: 64 })
  connectionUid!: string;

  @Column({ type: "boolean", nullable: true })
  ok!: boolean | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
