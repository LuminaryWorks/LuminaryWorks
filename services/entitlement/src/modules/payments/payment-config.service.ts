import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import {
  assertPaymentMasterKeyAvailable,
  credentialLastFour,
  decryptPaymentSecrets,
  encryptPaymentSecrets,
  fingerprintCredentials,
  fingerprintPaymentMasterKey,
  parsePaymentMasterKey,
  redactPaymentSecrets,
  type GenericCredentials,
} from "../../common/payment-crypto";
import { assertProviderCredentials } from "../../common/payment-credentials";
import {
  defaultCapabilities,
  isProviderId,
  type PaymentEnvironment,
  type ProviderCapabilities,
  type ProviderId,
} from "../../common/payment-providers";
import type { EntitlementConfig } from "../../config/entitlement.config";
import { EntitlementException } from "../../common/errors";
import { PaymentProviderConfigEntity } from "../../database/entities/payment-provider-config.entity";
import { AuditService } from "../audit/audit.service";
import { PAYMENT_ADAPTERS, type PaymentAdapter, type ProviderConfig } from "./payment-adapter";

export interface PaymentConfigPublicView {
  id: string;
  providerId: ProviderId;
  environment: PaymentEnvironment;
  enabled: boolean;
  status: string;
  marketScopes: string[];
  currencies: string[];
  priority: number;
  capabilities: ProviderCapabilities;
  merchantId: string | null;
  credentialFingerprint: string;
  credentialLastFour: string;
  keyFingerprint: string;
  rotatedAt: string | null;
  retiringUntil: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class PaymentConfigService implements OnModuleInit {
  private readonly logger = new Logger(PaymentConfigService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PaymentProviderConfigEntity)
    private readonly configs: Repository<PaymentProviderConfigEntity>,
    private readonly audit: AuditService,
    @Inject(PAYMENT_ADAPTERS) private readonly adapters: PaymentAdapter[],
  ) {}

  async onModuleInit(): Promise<void> {
    const conf = this.conf();
    const enabledProviderConfigs = await this.configs.count({ where: { enabled: true } });
    assertPaymentMasterKeyAvailable({
      nodeEnv: conf.nodeEnv,
      masterKey: conf.paymentConfigMasterKey,
      enabledProviderConfigs,
    });
  }

  private conf(): EntitlementConfig {
    return this.config.getOrThrow<EntitlementConfig>("entitlement");
  }

  masterKeyBuffer(): Buffer {
    return parsePaymentMasterKey(this.conf().paymentConfigMasterKey);
  }

  toPublicView(row: PaymentProviderConfigEntity): PaymentConfigPublicView {
    return {
      id: row.id,
      providerId: row.providerId,
      environment: row.environment,
      enabled: row.enabled,
      status: row.status,
      marketScopes: row.marketScopes,
      currencies: row.currencies,
      priority: row.priority,
      capabilities: row.capabilities,
      merchantId: row.merchantId,
      credentialFingerprint: row.credentialFingerprint,
      credentialLastFour: row.credentialLastFour,
      keyFingerprint: row.keyFingerprint,
      rotatedAt: row.rotatedAt?.toISOString() ?? null,
      retiringUntil: row.previousRetiringUntil?.toISOString() ?? null,
      metadata: redactPaymentSecrets(row.metadata ?? {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(filter?: { providerId?: string; enabled?: boolean; environment?: string }) {
    const where: Record<string, unknown> = {};
    if (filter?.providerId) where.providerId = filter.providerId;
    if (filter?.enabled != null) where.enabled = filter.enabled;
    if (filter?.environment) where.environment = filter.environment;
    const rows = await this.configs.find({ where, order: { priority: "ASC", createdAt: "ASC" } });
    return { items: rows.map((row) => this.toPublicView(row)) };
  }

  async getPublic(id: string): Promise<PaymentConfigPublicView> {
    return this.toPublicView(await this.requireRow(id));
  }

  async create(input: {
    providerId: string;
    environment?: PaymentEnvironment;
    marketScopes?: string[];
    currencies?: string[];
    priority?: number;
    capabilities?: Partial<ProviderCapabilities>;
    merchantId?: string | null;
    credentials?: unknown;
    metadata?: Record<string, unknown>;
    enabled?: boolean;
    actor: string;
    requestId?: string;
  }): Promise<PaymentConfigPublicView> {
    if (!isProviderId(input.providerId)) {
      throw new EntitlementException("VALIDATION_ERROR", `Unknown provider ${input.providerId}`);
    }
    const credentials = this.credentialsOrEmpty(input.providerId, input.credentials);
    const encrypted = this.encryptCredentials(credentials);
    const capabilities = {
      ...defaultCapabilities(input.providerId),
      ...(input.capabilities ?? {}),
    };
    const enabled = input.enabled === true;
    const row = await this.configs.save(
      this.configs.create({
        providerId: input.providerId,
        environment: input.environment ?? "sandbox",
        enabled,
        status: enabled ? "active" : "disabled",
        marketScopes: input.marketScopes ?? [],
        currencies: (input.currencies ?? []).map((item) => item.toUpperCase()),
        priority: input.priority ?? 100,
        capabilities,
        merchantId: input.merchantId ?? null,
        credentialsCiphertext: encrypted.ciphertext,
        credentialFingerprint: encrypted.fingerprint,
        credentialLastFour: encrypted.lastFour,
        keyFingerprint: encrypted.keyFingerprint,
        metadata: redactPaymentSecrets(input.metadata ?? {}),
      }),
    );
    await this.audit.record({
      actor: input.actor,
      action: "payment_config.create",
      resourceType: "payment_provider_config",
      resourceId: row.id,
      requestId: input.requestId,
      payload: redactPaymentSecrets({
        providerId: row.providerId,
        environment: row.environment,
        credentialFingerprint: row.credentialFingerprint,
        credentialLastFour: row.credentialLastFour,
      }),
    });
    this.logger.log(`payment_config.create id=${row.id} provider=${row.providerId}`);
    return this.toPublicView(row);
  }

  async update(
    id: string,
    patch: {
      marketScopes?: string[];
      currencies?: string[];
      priority?: number;
      capabilities?: Partial<ProviderCapabilities>;
      merchantId?: string | null;
      metadata?: Record<string, unknown>;
      environment?: PaymentEnvironment;
      actor: string;
      requestId?: string;
    },
  ): Promise<PaymentConfigPublicView> {
    const row = await this.requireRow(id);
    if (patch.marketScopes) row.marketScopes = patch.marketScopes;
    if (patch.currencies) row.currencies = patch.currencies.map((item) => item.toUpperCase());
    if (patch.priority != null) row.priority = patch.priority;
    if (patch.capabilities) row.capabilities = { ...row.capabilities, ...patch.capabilities };
    if (patch.merchantId !== undefined) row.merchantId = patch.merchantId;
    if (patch.metadata) row.metadata = redactPaymentSecrets({ ...row.metadata, ...patch.metadata });
    if (patch.environment) row.environment = patch.environment;
    await this.configs.save(row);
    await this.audit.record({
      actor: patch.actor,
      action: "payment_config.update",
      resourceType: "payment_provider_config",
      resourceId: row.id,
      requestId: patch.requestId,
      payload: redactPaymentSecrets({
        providerId: row.providerId,
        credentialFingerprint: row.credentialFingerprint,
      }),
    });
    return this.toPublicView(row);
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    opts: { actor: string; requestId?: string },
  ): Promise<PaymentConfigPublicView> {
    const row = await this.requireRow(id);
    row.enabled = enabled;
    row.status = enabled ? "active" : "disabled";
    await this.configs.save(row);
    await this.audit.record({
      actor: opts.actor,
      action: enabled ? "payment_config.enable" : "payment_config.disable",
      resourceType: "payment_provider_config",
      resourceId: row.id,
      requestId: opts.requestId,
      payload: { providerId: row.providerId, enabled },
    });
    return this.toPublicView(row);
  }

  async rotate(
    id: string,
    credentialsRaw: unknown,
    opts: { actor: string; requestId?: string },
  ): Promise<PaymentConfigPublicView> {
    const row = await this.requireRow(id);
    const credentials = this.credentialsOrEmpty(row.providerId, credentialsRaw);
    const encrypted = this.encryptCredentials(credentials);
    const retiringHours = this.conf().paymentCredentialRetiringHours;
    row.previousCredentialsCiphertext = row.credentialsCiphertext || null;
    row.previousRetiringUntil = new Date(Date.now() + retiringHours * 3600 * 1000);
    row.credentialsCiphertext = encrypted.ciphertext;
    row.credentialFingerprint = encrypted.fingerprint;
    row.credentialLastFour = encrypted.lastFour;
    row.keyFingerprint = encrypted.keyFingerprint;
    row.rotatedAt = new Date();
    if (row.enabled) row.status = "retiring";
    await this.configs.save(row);
    await this.audit.record({
      actor: opts.actor,
      action: "payment_config.rotate",
      resourceType: "payment_provider_config",
      resourceId: row.id,
      requestId: opts.requestId,
      payload: {
        providerId: row.providerId,
        credentialFingerprint: row.credentialFingerprint,
        credentialLastFour: row.credentialLastFour,
        retiringUntil: row.previousRetiringUntil?.toISOString() ?? null,
      },
    });
    return this.toPublicView(row);
  }

  async testMetadata(id: string): Promise<{
    ok: boolean;
    issues: string[];
    capabilities: ProviderCapabilities;
    credentialFingerprint: string;
    credentialLastFour: string;
    providerId: string;
    environment: string;
  }> {
    const row = await this.requireRow(id);
    const adapter = this.adapterFor(row.providerId);
    const decrypted = this.decryptForAdapter(row);
    const health = await adapter.healthCheck(decrypted, { remote: true });
    return {
      ok: health.ok,
      issues: health.issues,
      capabilities: health.capabilities,
      credentialFingerprint: row.credentialFingerprint,
      credentialLastFour: row.credentialLastFour,
      providerId: row.providerId,
      environment: row.environment,
    };
  }

  async loadEnabled(id: string): Promise<PaymentProviderConfigEntity | null> {
    const row = await this.configs.findOne({ where: { id } });
    if (!row || !row.enabled || row.status === "disabled") return null;
    return row;
  }

  decryptForAdapter(row: PaymentProviderConfigEntity, previous = false): ProviderConfig {
    const ciphertext = previous ? row.previousCredentialsCiphertext : row.credentialsCiphertext;
    const credentials = ciphertext
      ? (JSON.parse(
          decryptPaymentSecrets(ciphertext, this.masterKeyBuffer()),
        ) as GenericCredentials)
      : {};
    return {
      id: row.id,
      providerId: row.providerId,
      environment: row.environment,
      enabled: row.enabled,
      status: row.status,
      marketScopes: row.marketScopes,
      currencies: row.currencies,
      priority: row.priority,
      capabilities: row.capabilities,
      merchantId: row.merchantId,
      credentials,
      metadata: row.metadata ?? {},
    };
  }

  decryptCurrentAndPrevious(row: PaymentProviderConfigEntity): ProviderConfig[] {
    const configs = [this.decryptForAdapter(row, false)];
    if (
      row.previousCredentialsCiphertext &&
      row.previousRetiringUntil &&
      row.previousRetiringUntil.getTime() > Date.now()
    ) {
      configs.push(this.decryptForAdapter(row, true));
    }
    return configs;
  }

  adapterFor(providerId: string): PaymentAdapter {
    const found = this.adapters.find((adapter) => adapter.provider === providerId);
    if (!found) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        `No adapter for ${providerId}`,
      );
    }
    return found;
  }

  async listEnabledRows(): Promise<PaymentProviderConfigEntity[]> {
    return this.configs.find({ where: { enabled: true }, order: { priority: "ASC" } });
  }

  private credentialsOrEmpty(providerId: ProviderId, raw: unknown): GenericCredentials {
    if (raw == null) {
      if (providerId === "manual" || providerId === "contract") return {};
      throw new EntitlementException("VALIDATION_ERROR", "credentials object is required");
    }
    return assertProviderCredentials(providerId, raw);
  }

  private encryptCredentials(credentials: GenericCredentials): {
    ciphertext: string;
    fingerprint: string;
    lastFour: string;
    keyFingerprint: string;
  } {
    const key = this.masterKeyBuffer();
    const plaintext = JSON.stringify(credentials);
    return {
      ciphertext: encryptPaymentSecrets(plaintext, key),
      fingerprint: fingerprintCredentials(credentials),
      lastFour: credentialLastFour(credentials),
      keyFingerprint: fingerprintPaymentMasterKey(key),
    };
  }

  private async requireRow(id: string): Promise<PaymentProviderConfigEntity> {
    const row = await this.configs.findOne({ where: { id } });
    if (!row)
      throw new EntitlementException("NOT_FOUND", `Payment provider config ${id} not found`);
    return row;
  }
}
