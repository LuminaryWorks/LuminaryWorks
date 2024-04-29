import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** Replay protection for partner inbound callbacks (nonce + timestamp window). */
@Entity({ name: "partner_nonces" })
@Index(["partnerId", "nonce"], { unique: true })
export class PartnerNonceEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "partner_id", type: "uuid" })
  partnerId!: string;

  @Column({ type: "varchar", length: 128 })
  nonce!: string;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
