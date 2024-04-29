import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { AuditLogEntity } from "../../database/entities/audit-log.entity";

export interface AuditWriteInput {
  actor: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
  requestId?: string | null;
  payload?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly audits: Repository<AuditLogEntity>,
  ) {}

  async record(input: AuditWriteInput): Promise<void> {
    const row = this.audits.create({
      actor: input.actor,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      payload: input.payload ?? null,
    });
    await this.audits.save(row);
    this.logger.log(
      `audit action=${input.action} actor=${input.actor} resource=${input.resourceType}:${input.resourceId ?? "-"}`,
    );
  }
}
