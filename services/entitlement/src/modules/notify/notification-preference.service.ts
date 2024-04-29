import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { NotificationPreferenceEntity } from "../../database/entities/notification-preference.entity";
import type { UpsertNotificationPreferenceDto } from "../partner/partner.dto";

@Injectable()
export class NotificationPreferenceService {
  constructor(
    @InjectRepository(NotificationPreferenceEntity)
    private readonly prefs: Repository<NotificationPreferenceEntity>,
  ) {}

  async getOrDefault(logtoSub: string): Promise<NotificationPreferenceEntity> {
    const existing = await this.prefs.findOne({ where: { logtoSub } });
    if (existing) return existing;
    return this.prefs.create({
      logtoSub,
      emailEnabled: true,
      inAppEnabled: true,
      pushEnabled: true,
      emailAddress: null,
      pushTokens: [],
      metadata: {},
    });
  }

  async upsert(logtoSub: string, dto: UpsertNotificationPreferenceDto) {
    let row = await this.prefs.findOne({ where: { logtoSub } });
    if (!row) {
      row = this.prefs.create({
        logtoSub,
        emailEnabled: dto.emailEnabled ?? true,
        inAppEnabled: dto.inAppEnabled ?? true,
        pushEnabled: dto.pushEnabled ?? true,
        emailAddress: dto.emailAddress ?? null,
        pushTokens: dto.pushTokens ?? [],
        metadata: {},
      });
    } else {
      if (dto.emailEnabled != null) row.emailEnabled = dto.emailEnabled;
      if (dto.inAppEnabled != null) row.inAppEnabled = dto.inAppEnabled;
      if (dto.pushEnabled != null) row.pushEnabled = dto.pushEnabled;
      if (dto.emailAddress !== undefined) row.emailAddress = dto.emailAddress ?? null;
      if (dto.pushTokens) row.pushTokens = dto.pushTokens;
    }
    return this.prefs.save(row);
  }
}
