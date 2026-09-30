import type { IdempotencyClaim, IdempotencyRecord, IdempotencyStore } from "@luminaryworks/notification";
import { randomUUID } from "node:crypto";
import type { Repository } from "typeorm";
import type { EmailMessageEntity } from "../database/entities/email-message.entity";

interface MessageRow {
  idempotency_key?: string;
  status: IdempotencyRecord["status"];
  provider_id?: string | null;
  provider_message_id?: string | null;
}

/** TypeORM's pg driver returns UPDATE/DELETE as `[rows, rowCount]` and other commands as `rows`. */
export function unwrapPgQuery<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number") {
    return result[0] as T[];
  }
  return result as T[];
}

export class PgIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly messages: Repository<EmailMessageEntity>,
    private readonly meta: { type: string; to: string },
  ) {}

  async claim(key: string): Promise<IdempotencyClaim> {
    const inserted = unwrapPgQuery<MessageRow>(
      await this.messages.query(
        `INSERT INTO email_messages (id, idempotency_key, usage_type, to_address, status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING idempotency_key, status, provider_id, provider_message_id`,
        [randomUUID(), key, this.meta.type, this.meta.to],
      ),
    )[0];
    if (inserted) return { owned: true, record: mapRow(inserted, key) };
    return { owned: false, record: await this.load(key) };
  }

  async reclaimFailed(key: string): Promise<IdempotencyClaim> {
    const updated = unwrapPgQuery<MessageRow>(
      await this.messages.query(
        `UPDATE email_messages
         SET status = 'pending', provider_id = NULL, provider_message_id = NULL, updated_at = now()
         WHERE idempotency_key = $1 AND status = 'failed'
         RETURNING idempotency_key, status, provider_id, provider_message_id`,
        [key],
      ),
    )[0];
    if (updated) return { owned: true, record: mapRow(updated, key) };
    return { owned: false, record: await this.load(key) };
  }

  async save(record: IdempotencyRecord): Promise<void> {
    await this.messages.query(
      `UPDATE email_messages
       SET status = $2, provider_id = $3, provider_message_id = $4, updated_at = now()
       WHERE idempotency_key = $1`,
      [record.key, record.status, record.providerId ?? null, record.providerMessageId ?? null],
    );
  }

  private async load(key: string): Promise<IdempotencyRecord> {
    const row = unwrapPgQuery<MessageRow>(
      await this.messages.query(
        `SELECT idempotency_key, status, provider_id, provider_message_id
         FROM email_messages WHERE idempotency_key = $1`,
        [key],
      ),
    )[0];
    if (!row) return { key, status: "pending" };
    return mapRow(row, key);
  }
}

function mapRow(row: MessageRow, key: string): IdempotencyRecord {
  return {
    key: row.idempotency_key || key,
    status: row.status,
    providerId: row.provider_id || undefined,
    providerMessageId: row.provider_message_id || undefined,
  };
}
