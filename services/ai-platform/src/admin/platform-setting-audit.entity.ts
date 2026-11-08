import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

/** Append-only record of operator setting changes. */
@Entity({ name: "platform_setting_audits" })
export class PlatformSettingAuditEntity {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ name: "setting_key", type: "varchar", length: 64 })
  settingKey!: string;

  @Column({ name: "actor_sub", type: "varchar", length: 128 })
  actorSub!: string;

  @Column({ name: "previous_json", type: "jsonb", nullable: true })
  previousJson!: Record<string, unknown> | null;

  @Column({ name: "next_json", type: "jsonb" })
  nextJson!: Record<string, unknown>;

  @Column({ type: "varchar", length: 512, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
