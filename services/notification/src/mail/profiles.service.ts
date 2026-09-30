import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { MailProfileEntity } from "../database/entities/mail-profile.entity";
import type { NotificationConfig } from "../config/notification.config";
import { sealJson } from "../crypto/seal";
import { completeProfileWrite, parseProfileWrite, type ProfileWrite } from "./profile-input";

export interface ProfileView {
  id: string;
  scope: MailProfileEntity["scope"];
  organizationId: string | null;
  from: string;
  fromName: string | null;
  provider: MailProfileEntity["provider"];
  matchDomains: string[];
  verified: boolean;
  enabled: boolean;
  usage: MailProfileEntity["usage"];
  priority: number;
  dailyQuota: number;
  monthlyQuota: number;
  credentialsSet: true;
}

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(MailProfileEntity)
    private readonly profiles: Repository<MailProfileEntity>,
    private readonly config: ConfigService,
  ) {}

  async list(): Promise<ProfileView[]> {
    const rows = await this.profiles.find({ order: { priority: "ASC", createdAt: "ASC" } });
    return rows.map(toView);
  }

  async create(body: unknown): Promise<ProfileView> {
    const write = completeProfileWrite(body);
    const saved = await this.profiles.save(this.entityFromWrite(randomUUID(), write));
    return toView(saved);
  }

  async update(id: string, body: unknown): Promise<ProfileView> {
    const existing = await this.profiles.findOneBy({ id });
    if (!existing) throw new NotFoundException();
    const raw =
      body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
    if (raw.credentials !== undefined && raw.provider === undefined) {
      raw.provider = existing.provider;
    }
    const patch = parseProfileWrite(raw, true);
    const scope = patch.scope ?? existing.scope;
    existing.scope = scope;
    if (patch.scope !== undefined || patch.organizationId !== undefined) {
      existing.organizationId =
        scope === "organization" ? (patch.organizationId ?? existing.organizationId) : null;
    }
    if (patch.fromAddress) existing.fromAddress = patch.fromAddress;
    if (patch.fromName !== undefined) existing.fromName = patch.fromName;
    if (patch.provider) existing.provider = patch.provider;
    if (patch.credentials) existing.credentialsCipher = sealJson(patch.credentials, this.secret());
    if (patch.matchDomains !== undefined) existing.matchDomains = patch.matchDomains;
    if (patch.verified !== undefined) existing.verified = patch.verified;
    if (patch.enabled !== undefined) existing.enabled = patch.enabled;
    if (patch.usage) existing.usage = patch.usage;
    if (patch.priority !== undefined) existing.priority = patch.priority;
    if (patch.dailyQuota !== undefined) existing.dailyQuota = patch.dailyQuota;
    if (patch.monthlyQuota !== undefined) existing.monthlyQuota = patch.monthlyQuota;
    return toView(await this.profiles.save(existing));
  }

  async remove(id: string): Promise<{ ok: true }> {
    const result = await this.profiles.delete({ id });
    if (!result.affected) throw new NotFoundException();
    return { ok: true };
  }

  private entityFromWrite(id: string, write: ProfileWrite): MailProfileEntity {
    return this.profiles.create({
      id,
      scope: write.scope,
      organizationId: write.scope === "organization" ? write.organizationId : null,
      fromAddress: write.fromAddress,
      fromName: write.fromName,
      provider: write.provider,
      credentialsCipher: sealJson(write.credentials, this.secret()),
      matchDomains: write.matchDomains,
      verified: write.verified,
      enabled: write.enabled,
      usage: write.usage,
      priority: write.priority,
      dailyQuota: write.dailyQuota,
      monthlyQuota: write.monthlyQuota,
    });
  }

  private secret(): string {
    return this.config.getOrThrow<NotificationConfig>("notification").secretKey;
  }
}

function toView(row: MailProfileEntity): ProfileView {
  return {
    id: row.id,
    scope: row.scope,
    organizationId: row.organizationId,
    from: row.fromAddress,
    fromName: row.fromName,
    provider: row.provider,
    matchDomains: row.matchDomains ?? [],
    verified: row.verified,
    enabled: row.enabled,
    usage: row.usage,
    priority: row.priority,
    dailyQuota: row.dailyQuota,
    monthlyQuota: row.monthlyQuota,
    credentialsSet: true,
  };
}
