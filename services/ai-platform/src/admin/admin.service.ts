import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, type QueryRunner } from "typeorm";
import type { AiPlatformConfig } from "../config/ai-platform.config";
import { AiPlatformException } from "../common/errors";
import { microToNumber } from "../wallet/money";
import {
  notePublicApiSnapshot,
  PUBLIC_API_CACHE_TTL_MS,
  publicApiSnapshotFresh,
  publicApiSource,
  readPublicApiEnabled,
  readWalletEnforce,
  registerPublicApiRefresher,
  vaultKeyUsable,
} from "../policy";
import { AiPlatformSettings1762700000000 } from "./1762700000000-AiPlatformSettings";

const PUBLIC_API_KEY = "public_api_enabled";

export interface HardeningGates {
  authn: boolean;
  entitlement: boolean;
  persistentMetering: boolean;
  secretVault: boolean;
  readiness: boolean;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async ensureSchema(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const migration = new AiPlatformSettings1762700000000();
      await migration.up(runner);
      await this.recordMigration(runner, migration.name);
    } finally {
      await runner.release();
    }
  }

  registerRefresher(): void {
    registerPublicApiRefresher(async () => {
      if (publicApiSnapshotFresh()) return;
      await this.loadPublicApiSnapshot();
    });
  }

  async settings(): Promise<{
    publicApiEnabled: boolean;
    publicApiSource: "persisted" | "env";
    walletEnforce: boolean;
    hardeningGates: HardeningGates;
  }> {
    await this.loadPublicApiSnapshot();
    const conf = this.config.getOrThrow<AiPlatformConfig>("aiPlatform");
    return {
      publicApiEnabled: readPublicApiEnabled(),
      publicApiSource: publicApiSource(),
      walletEnforce: readWalletEnforce(),
      hardeningGates: {
        authn:
          conf.authMode === "oidc"
            ? Boolean(conf.issuer && conf.audience && conf.jwksUri)
            : Boolean(conf.legacyJwtSecret),
        entitlement: Boolean(conf.entitlementBaseUrl && conf.entitlementServiceKey),
        persistentMetering: await this.usageTableReady(),
        secretVault: vaultKeyUsable(process.env.AI_VAULT_MASTER_KEY),
        readiness: true,
      },
    };
  }

  async setPublicApi(enabled: boolean, actor: string, reason: string | null): Promise<{
    publicApiEnabled: boolean;
    publicApiSource: "persisted";
  }> {
    const previous = await this.readSetting(PUBLIC_API_KEY);
    const next = { enabled };
    await this.dataSource.query(
      `INSERT INTO platform_settings (setting_key, value_json, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (setting_key) DO UPDATE
       SET value_json = EXCLUDED.value_json, updated_at = now()`,
      [PUBLIC_API_KEY, JSON.stringify(next)],
    );
    await this.dataSource.query(
      `INSERT INTO platform_setting_audits
         (id, setting_key, actor_sub, previous_json, next_json, reason)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
      [
        randomUUID(),
        PUBLIC_API_KEY,
        actor.slice(0, 128) || "service:internal",
        previous ? JSON.stringify(previous) : null,
        JSON.stringify(next),
        reason ? reason.slice(0, 512) : null,
      ],
    );
    notePublicApiSnapshot(true, enabled, PUBLIC_API_CACHE_TTL_MS);
    return { publicApiEnabled: enabled, publicApiSource: "persisted" };
  }

  async lookupWallet(ownerKind: string, ownerId: string): Promise<{
    wallet: {
      walletId: string;
      ownerKind: string;
      ownerId: string;
      currency: string;
      status: string;
      createdAt: string | null;
    } | null;
    reconciliation: {
      grantedMicro: number;
      remainingMicro: number;
      activeHoldMicro: number;
      settledMicro: number;
      revokedMicro: number;
      balanced: boolean;
    } | null;
    grants: Array<Record<string, unknown>>;
  }> {
    if (ownerKind !== "user" && ownerKind !== "organization") {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "ownerKind is invalid");
    }
    const id = ownerId.trim();
    if (!id) throw new AiPlatformException("VALIDATION_ERROR", 400, "ownerId is required");
    const found = rowsOf(
      await this.dataSource.query(
        `SELECT wallet_id, owner_kind, owner_id, currency, status, created_at
         FROM wallets WHERE owner_kind = $1 AND owner_id = $2`,
        [ownerKind, id],
      ),
    );
    const wallet = found[0];
    if (!wallet) return { wallet: null, reconciliation: null, grants: [] };
    const walletId = String(wallet.wallet_id);
    return {
      wallet: {
        walletId,
        ownerKind: String(wallet.owner_kind),
        ownerId: String(wallet.owner_id),
        currency: String(wallet.currency),
        status: String(wallet.status),
        createdAt: asIso(wallet.created_at),
      },
      reconciliation: await this.reconciliation(walletId),
      grants: await this.grants(walletId),
    };
  }

  async usage(input: {
    from: Date;
    to: Date;
    productCode: string | null;
    limit: number;
  }): Promise<{
    from: string;
    to: string;
    productCode: string | null;
    summary: UsageTotals;
    groups: Array<UsageTotals & { productCode: string; capability: string }>;
  }> {
    const params = [input.from, input.to, input.productCode];
    const where = `at >= $1 AND at <= $2 AND ($3::varchar IS NULL OR product_code = $3)`;
    const summaryRows = rowsOf(
      await this.dataSource.query(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(charged_micro), 0) AS charged,
                COALESCE(SUM(upstream_cost_micro_usd), 0) AS cost
         FROM ai_usage_events WHERE ${where}`,
        params,
      ),
    );
    const groupRows = rowsOf(
      await this.dataSource.query(
        `SELECT product_code,
                COALESCE(NULLIF(feature, ''), NULLIF(purpose, ''), 'unspecified') AS capability,
                COUNT(*) AS calls,
                COALESCE(SUM(charged_micro), 0) AS charged,
                COALESCE(SUM(upstream_cost_micro_usd), 0) AS cost
         FROM ai_usage_events
         WHERE ${where}
         GROUP BY product_code, COALESCE(NULLIF(feature, ''), NULLIF(purpose, ''), 'unspecified')
         ORDER BY COUNT(*) DESC, product_code ASC
         LIMIT $4`,
        [...params, input.limit],
      ),
    );
    return {
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      productCode: input.productCode,
      summary: totals(summaryRows[0] ?? {}),
      groups: groupRows.map((row) => ({
        productCode: String(row.product_code ?? ""),
        capability: String(row.capability ?? "unspecified"),
        ...totals(row),
      })),
    };
  }

  async rateCards(): Promise<{
    versions: Array<{
      id: string;
      version: number;
      effectiveFrom: string | null;
      createdAt: string | null;
      lines: Array<{
        capability: string;
        providerType: string;
        model: string;
        unit: string;
        upstreamCostMicroUsd: number;
        markupBps: number;
        fixedFeeMicro: number;
      }>;
    }>;
  }> {
    const cards = rowsOf(
      await this.dataSource.query(
        `SELECT rate_card_id, version, effective_from, created_at
         FROM rate_cards
         ORDER BY rate_card_id ASC, version DESC`,
      ),
    );
    const lines = rowsOf(
      await this.dataSource.query(
        `SELECT rate_card_id, version, capability, provider_type, model, unit,
                upstream_cost_micro_usd, markup_bps, fixed_fee_micro
         FROM rate_card_lines
         ORDER BY capability ASC, provider_type ASC, model ASC, unit ASC`,
      ),
    );
    return {
      versions: cards.map((card) => {
        const id = String(card.rate_card_id);
        const version = Number(card.version);
        return {
          id,
          version,
          effectiveFrom: asIso(card.effective_from),
          createdAt: asIso(card.created_at),
          lines: lines
            .filter((line) => String(line.rate_card_id) === id && Number(line.version) === version)
            .map((line) => ({
              capability: String(line.capability),
              providerType: String(line.provider_type),
              model: String(line.model),
              unit: String(line.unit),
              upstreamCostMicroUsd: microToNumber(BigInt(String(line.upstream_cost_micro_usd ?? 0))),
              markupBps: Number(line.markup_bps ?? 0),
              fixedFeeMicro: microToNumber(BigInt(String(line.fixed_fee_micro ?? 0))),
            })),
        };
      }),
    };
  }

  async deploymentConnections(): Promise<{
    items: Array<{
      uid: string;
      ownerKind: string;
      ownerUid: string;
      providerType: string;
      displayName: string;
      baseUrl: string | null;
      model: string;
      enabled: boolean;
      isDefault: boolean;
      purpose: string | null;
      secretFingerprint: string | null;
      hasSecret: boolean;
      updatedAt: string | null;
    }>;
  }> {
    const rows = rowsOf(
      await this.dataSource.query(
        `SELECT uid, owner_kind, owner_uid, provider_type, display_name, base_url, model,
                enabled, is_default, purpose, secret_fingerprint,
                (ciphertext IS NOT NULL AND ciphertext <> '') AS has_secret,
                updated_at
         FROM provider_connections
         WHERE owner_kind = 'deployment'
         ORDER BY created_at ASC`,
      ),
    );
    return {
      items: rows.map((row) => ({
        uid: String(row.uid),
        ownerKind: String(row.owner_kind),
        ownerUid: String(row.owner_uid),
        providerType: String(row.provider_type),
        displayName: String(row.display_name),
        baseUrl: row.base_url == null ? null : String(row.base_url),
        model: String(row.model),
        enabled: row.enabled === true || row.enabled === "t" || row.enabled === "true",
        isDefault: row.is_default === true || row.is_default === "t" || row.is_default === "true",
        purpose: row.purpose == null ? null : String(row.purpose),
        secretFingerprint: row.secret_fingerprint == null ? null : String(row.secret_fingerprint),
        hasSecret: row.has_secret === true || row.has_secret === "t" || row.has_secret === "true",
        updatedAt: asIso(row.updated_at),
      })),
    };
  }

  private async loadPublicApiSnapshot(): Promise<void> {
    if (publicApiSnapshotFresh()) return;
    const value = await this.readSetting(PUBLIC_API_KEY);
    if (!value) {
      notePublicApiSnapshot(false, false, PUBLIC_API_CACHE_TTL_MS);
      return;
    }
    notePublicApiSnapshot(true, value.enabled === true, PUBLIC_API_CACHE_TTL_MS);
  }

  private async readSetting(key: string): Promise<Record<string, unknown> | null> {
    const rows = rowsOf(
      await this.dataSource.query(`SELECT value_json FROM platform_settings WHERE setting_key = $1`, [key]),
    );
    const raw = rows[0]?.value_json;
    if (raw == null) return null;
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    }
    if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
    return null;
  }

  private async reconciliation(walletId: string) {
    const rows = rowsOf(
      await this.dataSource.query(
        `SELECT
           (SELECT COALESCE(SUM(amount_micro), 0) FROM credit_grants WHERE wallet_id = $1) AS granted,
           (SELECT COALESCE(SUM(remaining_micro), 0) FROM credit_grants WHERE wallet_id = $1) AS remaining,
           (SELECT COALESCE(SUM(amount_micro), 0) FROM credit_holds WHERE wallet_id = $1 AND status = 'pending') AS holds,
           (SELECT COALESCE(SUM(settled_micro), 0) FROM credit_holds WHERE wallet_id = $1 AND status = 'settled') AS settled,
           (SELECT COALESCE(SUM(revoked_micro), 0) FROM credit_grants WHERE wallet_id = $1) AS revoked`,
        [walletId],
      ),
    );
    const row = rows[0] ?? {};
    const grantedMicro = BigInt(String(row.granted ?? 0));
    const remainingMicro = BigInt(String(row.remaining ?? 0));
    const activeHoldMicro = BigInt(String(row.holds ?? 0));
    const settledMicro = BigInt(String(row.settled ?? 0));
    const revokedMicro = BigInt(String(row.revoked ?? 0));
    return {
      grantedMicro: microToNumber(grantedMicro),
      remainingMicro: microToNumber(remainingMicro),
      activeHoldMicro: microToNumber(activeHoldMicro),
      settledMicro: microToNumber(settledMicro),
      revokedMicro: microToNumber(revokedMicro),
      balanced: grantedMicro === remainingMicro + activeHoldMicro + settledMicro + revokedMicro,
    };
  }

  private async grants(walletId: string): Promise<Array<Record<string, unknown>>> {
    const rows = rowsOf(
      await this.dataSource.query(
        `SELECT grant_id, wallet_id, kind, amount_micro, remaining_micro, expires_at, created_at,
                restrict_product_codes, restrict_capabilities, source_type, source_id,
                revoked_micro, revoke_shortfall_micro, revoked_at
         FROM credit_grants WHERE wallet_id = $1 ORDER BY created_at ASC`,
        [walletId],
      ),
    );
    return rows.map((row) => ({
      grantId: String(row.grant_id),
      walletId: String(row.wallet_id),
      kind: String(row.kind),
      amountMicro: microToNumber(BigInt(String(row.amount_micro ?? 0))),
      remainingMicro: microToNumber(BigInt(String(row.remaining_micro ?? 0))),
      expiresAt: asIso(row.expires_at),
      createdAt: asIso(row.created_at),
      restrictProductCodes: asList(row.restrict_product_codes),
      restrictCapabilities: asList(row.restrict_capabilities),
      sourceType: String(row.source_type ?? ""),
      sourceId: String(row.source_id ?? ""),
      revokedMicro: microToNumber(BigInt(String(row.revoked_micro ?? 0))),
      revokeShortfallMicro: microToNumber(BigInt(String(row.revoke_shortfall_micro ?? 0))),
      revokedAt: asIso(row.revoked_at),
    }));
  }

  private async usageTableReady(): Promise<boolean> {
    try {
      await this.dataSource.query(`SELECT 1 FROM ai_usage_events LIMIT 1`);
      return true;
    } catch {
      return false;
    }
  }

  private async recordMigration(runner: QueryRunner, name: string): Promise<void> {
    try {
      const reg = (await runner.query(`SELECT to_regclass('public.migrations') AS rel`)) as Array<{
        rel: string | null;
      }>;
      if (!reg[0]?.rel) return;
      const found = (await runner.query(`SELECT 1 AS ok FROM migrations WHERE name = $1`, [name])) as unknown[];
      if (Array.isArray(found) && found.length > 0) return;
      await runner.query(`INSERT INTO migrations (timestamp, name) VALUES ($1, $2)`, [1762700000000, name]);
    } catch {
      // Tables are already created. A missing migrations catalog is not fatal.
    }
  }
}

interface UsageTotals {
  calls: number;
  chargedMicro: number;
  upstreamCostMicroUsd: number;
  marginMicro: number;
  marginPercent: number | null;
}

function totals(row: Record<string, unknown>): UsageTotals {
  const charged = BigInt(String(row.charged ?? row.charged_micro ?? 0));
  const cost = BigInt(String(row.cost ?? row.upstream_cost_micro_usd ?? 0));
  const margin = charged - cost;
  return {
    calls: Number(row.calls ?? 0),
    chargedMicro: microToNumber(charged),
    upstreamCostMicroUsd: microToNumber(cost),
    marginMicro: microToNumber(margin),
    marginPercent: charged === 0n ? null : Number((margin * 1000n) / charged) / 10,
  };
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(result)) return [];
  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number") {
    return result[0] as Array<Record<string, unknown>>;
  }
  return result as Array<Record<string, unknown>>;
}

function asIso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asList(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      return null;
    }
  }
  return null;
}
