import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from "typeorm";
import type { LegalPolicyKind } from "../../common/legal-policy";

/** Versioned Terms / Privacy / Trial-deletion acceptance. Subject is always the verified Logto sub. */
@Entity({ name: "policy_acceptances" })
@Unique("UQ_policy_acceptances_sub_kind_version", ["logtoSub", "policyKind", "policyVersion"])
export class PolicyAcceptanceEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ name: "logto_sub", type: "varchar", length: 128 })
  logtoSub!: string;

  @Column({ name: "policy_kind", type: "varchar", length: 64 })
  policyKind!: LegalPolicyKind;

  @Index()
  @Column({ name: "policy_version", type: "varchar", length: 64 })
  policyVersion!: string;

  @Column({ name: "document_key", type: "varchar", length: 64 })
  documentKey!: string;

  @Column({ name: "document_version", type: "varchar", length: 64 })
  documentVersion!: string;

  @Column({ name: "accepted_at", type: "timestamptz" })
  acceptedAt!: Date;

  @Column({ type: "varchar", length: 64, nullable: true })
  ip!: string | null;

  @Column({ name: "user_agent", type: "varchar", length: 512, nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
