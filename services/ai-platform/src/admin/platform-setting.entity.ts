import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** Operator settings. Ledger mutations do not live here. */
@Entity({ name: "platform_settings" })
export class PlatformSettingEntity {
  @PrimaryColumn({ name: "setting_key", type: "varchar", length: 64 })
  settingKey!: string;

  @Column({ name: "value_json", type: "jsonb" })
  valueJson!: Record<string, unknown>;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
