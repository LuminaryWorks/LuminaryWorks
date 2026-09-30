import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "provider_quota_counters" })
export class ProviderQuotaEntity {
  @PrimaryColumn({ name: "provider_key", type: "varchar", length: 128 })
  providerKey!: string;

  @PrimaryColumn({ name: "period_key", type: "varchar", length: 16 })
  periodKey!: string;

  @Column({ name: "sent_count", type: "int", default: 0 })
  sentCount!: number;
}
