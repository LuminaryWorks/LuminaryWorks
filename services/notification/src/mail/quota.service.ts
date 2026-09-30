import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ProviderQuotaEntity } from "../database/entities/provider-quota.entity";

export function quotaPeriodKeys(now = new Date()): { day: string; month: string } {
  const iso = now.toISOString();
  return { day: `d:${iso.slice(0, 10)}`, month: `m:${iso.slice(0, 7)}` };
}

@Injectable()
export class QuotaService {
  constructor(
    @InjectRepository(ProviderQuotaEntity)
    private readonly counters: Repository<ProviderQuotaEntity>,
  ) {}

  async counts(providerKey: string): Promise<{ sentToday: number; sentThisMonth: number }> {
    const { day, month } = quotaPeriodKeys();
    const rows = await this.counters.find({
      where: [
        { providerKey, periodKey: day },
        { providerKey, periodKey: month },
      ],
    });
    return {
      sentToday: rows.find((row) => row.periodKey === day)?.sentCount ?? 0,
      sentThisMonth: rows.find((row) => row.periodKey === month)?.sentCount ?? 0,
    };
  }

  async increment(providerKey: string): Promise<void> {
    const { day, month } = quotaPeriodKeys();
    for (const periodKey of [day, month]) {
      await this.counters.query(
        `INSERT INTO provider_quota_counters (provider_key, period_key, sent_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (provider_key, period_key)
         DO UPDATE SET sent_count = provider_quota_counters.sent_count + 1`,
        [providerKey, periodKey],
      );
    }
  }
}
