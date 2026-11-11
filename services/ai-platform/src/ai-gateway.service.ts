import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  completeLocal,
  connectionHasPurpose,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  listProviderModels,
  streamLocal,
  synthesizeLocal,
  transcribeLocal,
  ttsCacheKey,
  type AiCompleteMessage,
  type AiProviderModelList,
  type AiUsageEvent,
} from "@luminaryworks/ai-client";
import type { AiPrincipal } from "./auth/auth.types";
import {
  assertCanManageConnection,
  assertCanUseConnection,
  assertHostedCaller,
  assertInferenceProduct,
  bindCaller,
  canManageConnection,
} from "./authz";
import { AiPlatformException } from "./common/errors";
import { AiUsageEventEntity, ConnectionAuditEventEntity, ProviderConnectionEntity } from "./database/entities";
import type { ConnectionAuditAction } from "./database/entities/connection-audit-event.entity";
import type { ConnectionOwnerKind } from "./database/entities/provider-connection.entity";
import { probeRateKey, probeRateLimiter } from "./probe-rate-limit";
import { probeProviderConnection } from "./provider-probe";
import { logProviderFailure, redactText } from "./redact";
import { assertSafeBaseUrl, iterateWithPin, pinProviderEndpoint, runWithPin, type PinnedTarget } from "./ssrf";
import { EntitlementGate } from "./entitlement-gate";
import { ephemeralSecretAllowed, isByokPath, isProductionEnv, readWalletEnforce } from "./policy";
import {
  enforceHostedProductRpm,
  hostedLimitApplies,
  productLimitFor,
  releaseHostedDailyCharge,
  reserveHostedDailyCharge,
} from "./product-limits";
import { readTtsCache, writeTtsCache } from "./tts-cache";
import { microToNumber } from "./wallet/money";
import type { UsageQuantities } from "./wallet/rate-card";
import { WalletService, type OwnerKind, type Settlement } from "./wallet/wallet.service";

export interface ProviderConnectionPublic {
  uid: string;
  ownerKind: ConnectionOwnerKind;
  ownerUid: string;
  productCode?: string | null;
  providerType: string;
  displayName: string;
  baseUrl?: string;
  model: string;
  enabled: boolean;
  isDefault?: boolean;
  purpose?: string | null;
  extra?: Record<string, string> | null;
  secretFingerprint?: string;
  hasSecret: boolean;
}

export interface ListConnectionsQuery {
  ownerKind?: ConnectionOwnerKind;
  ownerUid?: string;
  productCode?: string;
}

export interface EphemeralSecret {
  providerType: string;
  model: string;
  secret: string;
  baseUrl?: string;
}

interface CallOptions {
  purpose: "chat" | "stt" | "tts";
  allowEphemeral?: boolean;
  surface?: "product" | "public";
  principal: AiPrincipal;
}

interface ResolvedCall {
  providerType: string;
  model: string;
  baseUrl?: string;
  secret: string;
  routeTier: string;
  connectionUid?: string;
  byok: boolean;
  caller: { subjectId: string; organizationId: string | null };
  productCode: string;
  pin: PinnedTarget | null;
}

interface ManagedReservation {
  requestId: string;
  capability: string;
  productCode: string;
  estimateMicro: bigint;
  /** False when the wallet is off and the reservation only tracks a product ceiling. */
  wallet: boolean;
}

@Injectable()
export class AiGatewayService {
  constructor(
    @InjectRepository(ProviderConnectionEntity)
    private readonly connections: Repository<ProviderConnectionEntity>,
    @InjectRepository(AiUsageEventEntity)
    private readonly usage: Repository<AiUsageEventEntity>,
    @InjectRepository(ConnectionAuditEventEntity)
    private readonly audits: Repository<ConnectionAuditEventEntity>,
    private readonly entitlement: EntitlementGate,
    private readonly wallet: WalletService,
  ) {}

  async listConnections(
    principal: AiPrincipal,
    query: ListConnectionsQuery = {},
  ): Promise<ProviderConnectionPublic[]> {
    const ownerKind = query.ownerKind?.trim() as ConnectionOwnerKind | undefined;
    const ownerUid = query.ownerUid?.trim() || undefined;
    const productCode = query.productCode?.trim() || undefined;

    if (principal.kind === "service") {
      if (!ownerKind || !ownerUid) {
        throw new AiPlatformException(
          "VALIDATION_ERROR",
          400,
          "service callers must pass ownerKind and ownerUid",
        );
      }
    }

    const where: {
      ownerKind?: ConnectionOwnerKind;
      ownerUid?: string;
      productCode?: string;
    } = {};
    if (ownerKind) where.ownerKind = ownerKind;
    if (ownerUid) where.ownerUid = ownerUid;
    if (productCode) where.productCode = productCode;

    const rows = await this.connections.find({
      where: Object.keys(where).length > 0 ? where : undefined,
      order: { createdAt: "ASC" },
    });
    const visible =
      principal.kind === "service" ? rows : rows.filter((row) => canManageConnection(principal, row));
    return visible.map((row) => toPublic(row));
  }

  async upsertConnection(input: {
    uid?: string;
    ownerKind: ConnectionOwnerKind;
    ownerUid: string;
    productCode?: string | null;
    providerType: string;
    displayName: string;
    baseUrl?: string | null;
    model: string;
    secret?: string;
    enabled?: boolean;
    isDefault?: boolean;
    purpose?: string | null;
    extra?: Record<string, string> | null;
  },
    principal: AiPrincipal,
  ): Promise<ProviderConnectionPublic> {
    const uid = input.uid || `conn_${randomUUID()}`;
    const prev = await this.connections.findOne({ where: { uid } });
    if (prev) assertCanManageConnection(principal, prev);
    assertCanManageConnection(principal, { ownerKind: input.ownerKind, ownerUid: input.ownerUid });
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (baseUrl) await assertSafeBaseUrl(baseUrl);
    let ciphertext = prev?.ciphertext ?? null;
    let secretFingerprint = prev?.secretFingerprint ?? null;
    const secret = input.secret?.trim();
    if (secret) {
      const masterKey = process.env.AI_VAULT_MASTER_KEY?.trim() ?? "";
      if (!masterKey) {
        throw new AiPlatformException("VAULT_UNAVAILABLE", 503, "AI_VAULT_MASTER_KEY missing");
      }
      ciphertext = encryptSecret(masterKey, secret);
      secretFingerprint = fingerprintSecret(secret);
    }
    const productCode =
      input.productCode === undefined
        ? (prev?.productCode ?? null)
        : input.productCode?.trim() || null;
    const row = this.connections.create({
      uid,
      ownerKind: input.ownerKind,
      ownerUid: input.ownerUid,
      productCode,
      providerType: input.providerType,
      displayName: input.displayName,
      baseUrl,
      model: input.model,
      enabled: input.enabled ?? prev?.enabled ?? true,
      isDefault: input.isDefault ?? prev?.isDefault ?? false,
      purpose: input.purpose ?? prev?.purpose ?? "chat",
      extra: sanitizeExtra(input.extra === undefined ? prev?.extra : input.extra),
      secretFingerprint,
      ciphertext,
    });
    const saved = await this.connections.save(row);
    await this.audit({
      action: prev ? "update" : "create",
      principal,
      ownerKind: saved.ownerKind,
      ownerUid: saved.ownerUid,
      connectionUid: saved.uid,
      ok: true,
    });
    return toPublic(saved);
  }

  async updateConnection(
    uid: string,
    input: {
      ownerKind?: ConnectionOwnerKind;
      ownerUid?: string;
      productCode?: string | null;
      providerType?: string;
      displayName?: string;
      baseUrl?: string | null;
      model?: string;
      secret?: string;
      enabled?: boolean;
      isDefault?: boolean;
      purpose?: string | null;
      extra?: Record<string, string> | null;
    },
    principal: AiPrincipal,
  ): Promise<ProviderConnectionPublic> {
    const prev = await this.requireManaged(uid, principal);
    if (
      (input.ownerKind !== undefined && input.ownerKind !== prev.ownerKind) ||
      (input.ownerUid !== undefined && input.ownerUid !== prev.ownerUid)
    ) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "owner cannot be changed");
    }
    return this.upsertConnection(
      {
        uid,
        ownerKind: prev.ownerKind,
        ownerUid: prev.ownerUid,
        productCode: input.productCode === undefined ? prev.productCode : input.productCode,
        providerType: input.providerType ?? prev.providerType,
        displayName: input.displayName ?? prev.displayName,
        baseUrl: input.baseUrl === undefined ? prev.baseUrl : input.baseUrl,
        model: input.model ?? prev.model,
        secret: input.secret,
        enabled: input.enabled ?? prev.enabled,
        isDefault: input.isDefault ?? prev.isDefault,
        purpose: input.purpose === undefined ? prev.purpose : input.purpose,
        extra: input.extra === undefined ? prev.extra : input.extra,
      },
      principal,
    );
  }

  async deleteConnection(uid: string, principal: AiPrincipal): Promise<{ deleted: true; uid: string }> {
    const prev = await this.requireManaged(uid, principal);
    await this.audit({
      action: "delete",
      principal,
      ownerKind: prev.ownerKind,
      ownerUid: prev.ownerUid,
      connectionUid: prev.uid,
      ok: true,
    });
    await this.connections.delete({ uid: prev.uid });
    return { deleted: true, uid: prev.uid };
  }

  async testConnection(
    body: {
      connectionUid?: string;
      ephemeral?: EphemeralSecret;
    },
    principal: AiPrincipal,
  ): Promise<{
    ok: boolean;
    model?: string;
    latencyMs: number;
    hasSecret: boolean;
    secretFingerprint?: string;
    error?: { code: string; message: string };
  }> {
    this.consumeProbe(principal);
    const supplied = body.ephemeral?.secret?.trim() ?? "";
    this.assertEphemeral(Boolean(supplied), true);
    const target = await this.resolveProbeTarget(body, principal, supplied);
    const started = Date.now();
    const fingerprint = fingerprintSecret(target.secret);
    try {
      const probed = await probeProviderConnection({
        providerType: target.providerType,
        baseUrl: target.baseUrl,
        secret: target.secret,
        model: target.model,
      });
      await this.audit({
        action: "test",
        principal,
        ownerKind: target.ownerKind,
        ownerUid: target.ownerUid,
        connectionUid: target.connectionUid,
        ok: true,
      });
      return {
        ok: true,
        model: probed.model,
        latencyMs: Date.now() - started,
        hasSecret: true,
        secretFingerprint: fingerprint,
      };
    } catch (error) {
      if (error instanceof AiPlatformException) throw error;
      logProviderFailure("test-connection", error, [target.secret]);
      await this.audit({
        action: "test",
        principal,
        ownerKind: target.ownerKind,
        ownerUid: target.ownerUid,
        connectionUid: target.connectionUid,
        ok: false,
      });
      return {
        ok: false,
        latencyMs: Date.now() - started,
        hasSecret: true,
        secretFingerprint: fingerprint,
        error: {
          code: "PROVIDER_ERROR",
          message: redactText(error instanceof Error ? error.message : "connection test failed", [target.secret]),
        },
      };
    }
  }

  async listModels(
    body: {
      providerType?: string;
      baseUrl?: string;
      secret?: string;
      connectionUid?: string;
      purpose?: "chat" | "stt" | "tts";
      /** Same shape as /v1/providers/test — preferred by @luminaryworks/ai-client. */
      ephemeral?: EphemeralSecret;
    },
    principal: AiPrincipal,
  ): Promise<AiProviderModelList> {
    this.consumeProbe(principal);
    const supplied =
      body.secret?.trim() || body.ephemeral?.secret?.trim() || "";
    this.assertEphemeral(Boolean(supplied), true);
    const requested = `${body.purpose ?? "chat"}`;
    if (requested !== "chat" && requested !== "stt" && requested !== "tts") {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "purpose is invalid");
    }
    const purpose = requested;
    let providerType =
      body.providerType?.trim() || body.ephemeral?.providerType?.trim() || "";
    let baseUrl = body.baseUrl ?? body.ephemeral?.baseUrl;
    let secret = supplied;
    if (body.connectionUid) {
      const row = await this.requireUsable(body.connectionUid, principal);
      providerType = providerType || row.providerType;
      if (baseUrl === undefined) baseUrl = row.baseUrl ?? undefined;
      if (!secret && row.ciphertext) secret = this.decrypt(row.ciphertext);
    }
    if (!providerType) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "providerType is required");
    }
    if (baseUrl?.trim()) await assertSafeBaseUrl(baseUrl);
    const pin = secret ? await pinProviderEndpoint(providerType, baseUrl, "models") : null;
    const listed = await runWithPin(pin, () =>
      listProviderModels({
        providerType,
        baseUrl,
        secret: secret || undefined,
        purpose: purpose as "chat" | "stt" | "tts",
      }),
    );
    return { source: listed.source, models: listed.models };
  }

  async recordUsage(event: AiUsageEvent): Promise<void> {
    await this.usage.save(toUsageRow(event));
  }

  async listUsage(principal: AiPrincipal): Promise<AiUsageEvent[]> {
    const rows = await this.usage.find({
      where: principal.kind === "user" ? { subjectId: principal.subjectId } : {},
      order: { at: "DESC" },
      take: 200,
    });
    return rows.reverse().map(fromUsageRow);
  }

  async complete(
    body: {
      connectionUid?: string;
      ephemeral?: EphemeralSecret;
      messages: AiCompleteMessage[];
      jsonSchema?: Record<string, unknown>;
      maxTokens?: number;
      productCode?: string;
      subjectId?: string;
      organizationId?: string | null;
      feature?: string;
      routeTier?: string;
      idempotencyKey?: string;
      capability?: string;
    },
    opts: Omit<CallOptions, "purpose">,
  ) {
    const started = Date.now();
    const creds = await this.prepare(body, { ...opts, purpose: "chat" });
    const caller = creds.caller;
    const reservation = await this.beginManagedBill(creds, "chat", body);
    let result;
    try {
      result = await runWithPin(creds.pin, () =>
        completeLocal({
          providerType: creds.providerType,
          baseUrl: creds.baseUrl,
          model: creds.model,
          secret: creds.secret,
          messages: body.messages,
          jsonMode: Boolean(body.jsonSchema),
          maxTokens: body.maxTokens,
        }),
      );
    } catch (error) {
      await this.abortManagedBill(reservation);
      throw error;
    }
    const settlement = await this.finishManagedBill(reservation, creds, {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
    });
    await this.recordUsage({
      productCode: creds.productCode,
      subjectId: caller.subjectId,
      organizationId: caller.organizationId,
      feature: body.feature,
      purpose: "chat",
      providerType: result.providerType,
      model: result.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      billed: creds.byok ? "byok" : "managed",
      latencyMs: Date.now() - started,
      routeTier: creds.routeTier,
      estimatedCostMinor: estimateCost({
        purpose: "chat",
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
      }),
      status: "ok",
      traceId: result.traceId,
      at: new Date().toISOString(),
      surface: opts.surface ?? "product",
      ...billingFields(settlement),
    });
    return result;
  }

  async openStream(
    body: {
      connectionUid?: string;
      ephemeral?: EphemeralSecret;
      messages: AiCompleteMessage[];
      productCode?: string;
      subjectId?: string;
      organizationId?: string | null;
      feature?: string;
      routeTier?: string;
      maxTokens?: number;
      idempotencyKey?: string;
      capability?: string;
    },
    opts: Omit<CallOptions, "purpose">,
  ) {
    const creds = await this.prepare(body, { ...opts, purpose: "chat" });
    const reservation = await this.beginManagedBill(creds, "chat", body);
    let events;
    try {
      events = streamLocal({
        providerType: creds.providerType,
        baseUrl: creds.baseUrl,
        model: creds.model,
        secret: creds.secret,
        messages: body.messages,
      });
    } catch (error) {
      await this.abortManagedBill(reservation);
      throw error;
    }
    return iterateWithPin(
      creds.pin,
      this.finishStream(events, reservation, creds, body, opts.surface ?? "product"),
    );
  }

  embed(texts: string[]) {
    const dim = 16;
    const vectors = texts.map((text) => {
      const out = new Array<number>(dim).fill(0);
      const hash = createHash("sha256").update(text).digest();
      for (let i = 0; i < dim; i++) out[i] = (hash[i] ?? 0) / 255;
      return out;
    });
    return {
      vectors,
      model: "sha256-16",
      usage: { promptTokens: texts.join(" ").length, completionTokens: 0 },
      traceId: `trc_emb_${randomUUID()}`,
    };
  }

  async transcribe(
    body: {
      connectionUid?: string;
      ephemeral?: EphemeralSecret;
      audioBase64?: string;
      mime?: string;
      language?: string;
      productCode?: string;
      subjectId?: string;
      organizationId?: string | null;
      feature?: string;
      routeTier?: string;
      audioInputMs?: number;
      idempotencyKey?: string;
      capability?: string;
    },
    opts: Omit<CallOptions, "purpose">,
  ) {
    const started = Date.now();
    const audio = Buffer.from(body.audioBase64 ?? "", "base64");
    if (!audio.length) throw new Error("audioBase64 required");
    const creds = await this.prepare(body, { ...opts, purpose: "stt" });
    const audioInputMs = body.audioInputMs ?? estimateAudioMs(audio);
    const reservation = await this.beginManagedBill(creds, "stt", { ...body, audioInputMs });
    let result;
    try {
      result = await runWithPin(creds.pin, () =>
        transcribeLocal({
          providerType: creds.providerType,
          baseUrl: creds.baseUrl,
          model: creds.model,
          secret: creds.secret,
          audio,
          mime: body.mime,
          language: body.language,
        }),
      );
    } catch (error) {
      await this.abortManagedBill(reservation);
      throw error;
    }
    const settlement = await this.finishManagedBill(reservation, creds, { audioInputMs });
    await this.recordUsage({
      productCode: creds.productCode,
      subjectId: creds.caller.subjectId,
      organizationId: creds.caller.organizationId,
      feature: body.feature,
      purpose: "stt",
      providerType: result.providerType,
      model: result.model,
      promptTokens: 0,
      completionTokens: 0,
      audioInputMs,
      billed: creds.byok ? "byok" : "managed",
      latencyMs: Date.now() - started,
      routeTier: creds.routeTier,
      estimatedCostMinor: estimateCost({ purpose: "stt", audioInputMs }),
      status: "ok",
      traceId: result.traceId,
      at: new Date().toISOString(),
      surface: opts.surface ?? "product",
      ...billingFields(settlement),
    });
    return { ...result, audioInputMs };
  }

  async synthesize(
    body: {
      connectionUid?: string;
      ephemeral?: EphemeralSecret;
      text: string;
      voice?: string;
      locale?: string;
      speed?: number;
      productCode?: string;
      subjectId?: string;
      organizationId?: string | null;
      feature?: string;
      routeTier?: string;
      idempotencyKey?: string;
      capability?: string;
    },
    opts: Omit<CallOptions, "purpose">,
  ) {
    const started = Date.now();
    const creds = await this.prepare(body, { ...opts, purpose: "tts" });
    const key = ttsCacheKey({
      providerType: creds.providerType,
      model: creds.model,
      voice: body.voice,
      locale: body.locale,
      speed: body.speed,
      text: body.text,
    });
    const cached = readTtsCache(key);
    if (cached) {
      const audioOutputMs = estimateTtsMs(body.text, body.speed);
      await this.recordUsage({
        productCode: creds.productCode,
        subjectId: creds.caller.subjectId,
        organizationId: creds.caller.organizationId,
        feature: body.feature,
        purpose: "tts",
        providerType: creds.providerType,
        model: creds.model,
        promptTokens: 0,
        completionTokens: 0,
        audioOutputMs,
        billed: creds.byok ? "byok" : "managed",
        latencyMs: Date.now() - started,
        cacheHit: true,
        routeTier: creds.routeTier,
        estimatedCostMinor: 0,
        status: "ok",
        traceId: `trc_tts_cache_${key.slice(0, 12)}`,
        at: new Date().toISOString(),
        surface: opts.surface ?? "product",
      });
      return {
        audioBase64: cached.audioBase64,
        mime: cached.mime,
        model: creds.model,
        providerType: creds.providerType,
        traceId: `trc_tts_cache_${key.slice(0, 12)}`,
        audioOutputMs,
        cacheHit: true,
      };
    }
    const audioOutputMs = estimateTtsMs(body.text, body.speed);
    const reservation = await this.beginManagedBill(creds, "tts", { ...body, audioOutputMs });
    let result;
    try {
      result = await runWithPin(creds.pin, () =>
        synthesizeLocal({
          providerType: creds.providerType,
          baseUrl: creds.baseUrl,
          model: creds.model,
          secret: creds.secret,
          text: body.text,
          voice: body.voice,
        }),
      );
    } catch (error) {
      await this.abortManagedBill(reservation);
      throw error;
    }
    writeTtsCache(key, { audioBase64: result.audioBase64, mime: result.mime });
    const settlement = await this.finishManagedBill(reservation, creds, { audioOutputMs });
    await this.recordUsage({
      productCode: creds.productCode,
      subjectId: creds.caller.subjectId,
      organizationId: creds.caller.organizationId,
      feature: body.feature,
      purpose: "tts",
      providerType: result.providerType,
      model: result.model,
      promptTokens: 0,
      completionTokens: 0,
      audioOutputMs,
      billed: creds.byok ? "byok" : "managed",
      latencyMs: Date.now() - started,
      cacheHit: false,
      routeTier: creds.routeTier,
      estimatedCostMinor: estimateCost({ purpose: "tts", audioOutputMs }),
      status: "ok",
      traceId: result.traceId,
      at: new Date().toISOString(),
      surface: opts.surface ?? "product",
      ...billingFields(settlement),
    });
    return { ...result, audioOutputMs, cacheHit: false };
  }

  private async prepare(
    body: {
      connectionUid?: string;
      ephemeral?: EphemeralSecret;
      productCode?: string;
      subjectId?: string;
      organizationId?: string | null;
      feature?: string;
      routeTier?: string;
    },
    opts: CallOptions,
  ): Promise<ResolvedCall> {
    const caller = bindCaller(opts.principal, body);
    const hasSecret = Boolean(body.ephemeral?.secret);
    if (
      !ephemeralSecretAllowed({
        production: isProductionEnv(),
        allowEphemeral: opts.allowEphemeral === true,
        hasSecret,
      })
    ) {
      throw new AiPlatformException(
        "EPHEMERAL_NOT_ALLOWED",
        400,
        "ephemeral secrets are only allowed on POST /v1/providers/test and POST /v1/providers/models in production",
      );
    }

    const creds = hasSecret
      ? {
          providerType: body.ephemeral!.providerType,
          model: body.ephemeral!.model,
          baseUrl: body.ephemeral!.baseUrl,
          secret: body.ephemeral!.secret,
          routeTier: body.routeTier ?? "standard",
          connectionUid: body.connectionUid,
          ownerKind: null as string | null,
          ephemeral: true,
        }
      : await this.resolveSaved(body.connectionUid, opts.purpose, body.routeTier, opts.principal);

    const byok = isByokPath({
      ephemeral: creds.ephemeral,
      providerType: creds.providerType,
      ownerKind: creds.ownerKind,
    });
    if (!byok) assertHostedCaller(opts.principal);
    const productCode = assertInferenceProduct(opts.principal, body.productCode);
    const pin = await pinProviderEndpoint(creds.providerType, creds.baseUrl, "chat");
    if (hostedLimitApplies(byok)) {
      enforceHostedProductRpm(productCode);
      await this.entitlement.assertManaged({
        productCode,
        subjectId: caller.subjectId,
        feature: body.feature,
      });
    }
    return {
      providerType: creds.providerType,
      model: creds.model,
      baseUrl: creds.baseUrl,
      secret: creds.secret,
      routeTier: creds.routeTier,
      connectionUid: creds.connectionUid,
      byok,
      caller,
      productCode,
      pin,
    };
  }

  private async beginManagedBill(
    creds: ResolvedCall,
    purpose: "chat" | "stt" | "tts",
    body: {
      idempotencyKey?: string;
      capability?: string;
      maxTokens?: number;
      messages?: AiCompleteMessage[];
      text?: string;
      speed?: number;
      audioInputMs?: number;
      audioOutputMs?: number;
    },
  ): Promise<ManagedReservation | null> {
    if (creds.byok) return null;
    const ceiling = productLimitFor(creds.productCode);
    const walletOn = readWalletEnforce();
    if (!walletOn && !ceiling) return null;
    const requestId = body.idempotencyKey?.trim() ?? "";
    if (walletOn && !requestId) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "idempotencyKey is required");
    }
    const capability = body.capability?.trim() || defaultCapability(purpose);
    const usage = estimateQuantities(purpose, body);
    const quote = await this.wallet.quote({
      capability,
      providerType: creds.providerType,
      model: creds.model,
      usage,
    });
    if (quote.chargedMicro <= 0n) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "rate card priced the request at zero");
    }
    reserveHostedDailyCharge(creds.productCode, quote.chargedMicro);
    if (!walletOn) {
      return {
        requestId: requestId || `ceiling:${creds.productCode}`,
        capability,
        productCode: creds.productCode,
        estimateMicro: quote.chargedMicro,
        wallet: false,
      };
    }
    try {
      const owner = walletOwner(creds.caller);
      const wallet = await this.wallet.ensureWallet(owner.kind, owner.id);
      await this.wallet.reserve({
        requestId,
        walletId: wallet.walletId,
        estimateMicro: quote.chargedMicro,
        productCode: creds.productCode,
        capability,
      });
    } catch (error) {
      releaseHostedDailyCharge(creds.productCode, quote.chargedMicro);
      throw error;
    }
    return {
      requestId,
      capability,
      productCode: creds.productCode,
      estimateMicro: quote.chargedMicro,
      wallet: true,
    };
  }

  private async finishManagedBill(
    reservation: ManagedReservation | null,
    creds: ResolvedCall,
    usage: UsageQuantities,
  ): Promise<Settlement | null> {
    if (!reservation?.wallet) return null;
    return this.wallet.settle({
      requestId: reservation.requestId,
      capability: reservation.capability,
      providerType: creds.providerType,
      model: creds.model,
      usage,
    });
  }

  private async abortManagedBill(reservation: ManagedReservation | null): Promise<void> {
    if (!reservation) return;
    releaseHostedDailyCharge(reservation.productCode, reservation.estimateMicro);
    if (!reservation.wallet) return;
    await this.wallet.release(reservation.requestId).catch(() => undefined);
  }

  private async *finishStream(
    events: AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; result: { usage: { promptTokens: number; completionTokens: number }; model: string; providerType: string; traceId: string; text: string } }>,
    reservation: ManagedReservation | null,
    creds: ResolvedCall,
    body: {
      feature?: string;
      messages?: AiCompleteMessage[];
    },
    surface: "product" | "public",
  ) {
    const started = Date.now();
    let upstreamDone = false;
    let doneUsage = { promptTokens: 0, completionTokens: 0 };
    let traceId = "";
    let model = creds.model;
    let providerType = creds.providerType;
    try {
      for await (const ev of events) {
        if (ev.type === "done") {
          doneUsage = ev.result.usage;
          traceId = ev.result.traceId;
          model = ev.result.model;
          providerType = ev.result.providerType;
        }
        yield ev;
      }
      upstreamDone = true;
      if (!reservation) return;
      const settlement = await this.finishManagedBill(reservation, creds, doneUsage);
      await this.recordUsage({
        productCode: creds.productCode,
        subjectId: creds.caller.subjectId,
        organizationId: creds.caller.organizationId,
        feature: body.feature,
        purpose: "chat",
        providerType,
        model,
        promptTokens: doneUsage.promptTokens,
        completionTokens: doneUsage.completionTokens,
        billed: creds.byok ? "byok" : "managed",
        latencyMs: Date.now() - started,
        routeTier: creds.routeTier,
        estimatedCostMinor: estimateCost({
          purpose: "chat",
          promptTokens: doneUsage.promptTokens,
          completionTokens: doneUsage.completionTokens,
        }),
        status: "ok",
        traceId,
        at: new Date().toISOString(),
        surface,
        ...billingFields(settlement),
      });
    } finally {
      if (reservation && !upstreamDone) await this.abortManagedBill(reservation);
    }
  }

  private async resolveSaved(
    connectionUid: string | undefined,
    purpose: "chat" | "stt" | "tts",
    routeTier: string | undefined,
    principal: AiPrincipal,
  ) {
    const row = await this.pickConnection(connectionUid, purpose, routeTier, principal);
    if (!row) throw new Error("connection not found");
    assertCanUseConnection(principal, row);
    if (!row.enabled) throw new AiPlatformException("VALIDATION_ERROR", 400, "connection is disabled");
    if (!row.ciphertext) throw new Error("connection not found");
    return {
      providerType: row.providerType,
      model: row.model,
      baseUrl: row.baseUrl ?? undefined,
      secret: this.decrypt(row.ciphertext),
      routeTier: row.extra?.routeTier ?? routeTier ?? "standard",
      connectionUid: row.uid,
      ownerKind: row.ownerKind,
      ephemeral: false,
    };
  }

  private async pickConnection(
    connectionUid: string | undefined,
    purpose: "chat" | "stt" | "tts",
    routeTier: string | undefined,
    principal: AiPrincipal,
  ): Promise<ProviderConnectionEntity | null> {
    if (connectionUid) return this.connections.findOne({ where: { uid: connectionUid } });
    const wantedTier = (routeTier ?? "standard").toLowerCase();
    const enabled = (await this.connections.find({ where: { enabled: true } })).filter((row) => {
      if (!row.ciphertext) return false;
      if (principal.kind === "service") return row.ownerKind === "deployment";
      return canManageConnection(principal, row);
    });
    const byPurpose = enabled.filter((row) => connectionHasPurpose(row.purpose, purpose));
    const pool = byPurpose.length > 0 ? byPurpose : enabled;
    const byTier = pool.filter((row) => (row.extra?.routeTier ?? "standard").toLowerCase() === wantedTier);
    const ranked = (byTier.length > 0 ? byTier : pool).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    return ranked[0] ?? null;
  }

  private consumeProbe(principal: AiPrincipal): void {
    if (!probeRateLimiter().take(probeRateKey(principal))) {
      throw new AiPlatformException("RATE_LIMITED", 429, "too many provider probes");
    }
  }

  private assertEphemeral(hasSecret: boolean, allowEphemeral: boolean): void {
    if (
      !ephemeralSecretAllowed({
        production: isProductionEnv(),
        allowEphemeral,
        hasSecret,
      })
    ) {
      throw new AiPlatformException(
        "EPHEMERAL_NOT_ALLOWED",
        400,
        "ephemeral secrets are only allowed on POST /v1/providers/test and POST /v1/providers/models in production",
      );
    }
  }

  private decrypt(ciphertext: string): string {
    const masterKey = process.env.AI_VAULT_MASTER_KEY?.trim() ?? "";
    if (!masterKey) {
      throw new AiPlatformException("VAULT_UNAVAILABLE", 503, "AI_VAULT_MASTER_KEY missing");
    }
    return decryptSecret(masterKey, ciphertext);
  }

  private async requireManaged(uid: string, principal: AiPrincipal): Promise<ProviderConnectionEntity> {
    const row = await this.connections.findOne({ where: { uid } });
    if (!row) throw new AiPlatformException("VALIDATION_ERROR", 404, "connection not found");
    assertCanManageConnection(principal, row);
    return row;
  }

  private async requireUsable(uid: string, principal: AiPrincipal): Promise<ProviderConnectionEntity> {
    const row = await this.connections.findOne({ where: { uid } });
    if (!row) throw new AiPlatformException("VALIDATION_ERROR", 404, "connection not found");
    assertCanUseConnection(principal, row);
    return row;
  }

  private async resolveProbeTarget(
    body: { connectionUid?: string; ephemeral?: EphemeralSecret },
    principal: AiPrincipal,
    supplied: string,
  ): Promise<{
    providerType: string;
    model: string;
    baseUrl?: string;
    secret: string;
    ownerKind: string;
    ownerUid: string;
    connectionUid: string;
  }> {
    if (body.connectionUid && !supplied) {
      const row = await this.requireManaged(body.connectionUid, principal);
      if (!row.ciphertext) {
        throw new AiPlatformException("VALIDATION_ERROR", 400, "connection has no secret");
      }
      return {
        providerType: row.providerType,
        model: row.model,
        baseUrl: row.baseUrl ?? undefined,
        secret: this.decrypt(row.ciphertext),
        ownerKind: row.ownerKind,
        ownerUid: row.ownerUid,
        connectionUid: row.uid,
      };
    }
    if (!supplied || !body.ephemeral?.providerType?.trim()) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "connectionUid or secret is required");
    }
    return {
      providerType: body.ephemeral.providerType,
      model: body.ephemeral.model,
      baseUrl: body.ephemeral.baseUrl,
      secret: supplied,
      ownerKind: principal.kind === "user" ? "user" : "deployment",
      ownerUid: principal.subjectId,
      connectionUid: "ephemeral",
    };
  }

  private async audit(input: {
    action: ConnectionAuditAction;
    principal: AiPrincipal;
    ownerKind: string;
    ownerUid: string;
    connectionUid: string;
    ok?: boolean | null;
  }): Promise<void> {
    await this.audits.save(
      this.audits.create({
        id: randomUUID(),
        action: input.action,
        actorSub: input.principal.subjectId,
        actorKind: input.principal.kind,
        ownerKind: input.ownerKind,
        ownerUid: input.ownerUid,
        connectionUid: input.connectionUid,
        ok: input.ok ?? null,
      }),
    );
  }
}

function toPublic(row: ProviderConnectionEntity): ProviderConnectionPublic {
  return {
    uid: row.uid,
    ownerKind: row.ownerKind,
    ownerUid: row.ownerUid,
    productCode: row.productCode,
    providerType: row.providerType,
    displayName: row.displayName,
    baseUrl: row.baseUrl ?? undefined,
    model: row.model,
    enabled: row.enabled,
    isDefault: row.isDefault,
    purpose: row.purpose,
    extra: sanitizeExtra(row.extra),
    secretFingerprint: row.secretFingerprint ?? undefined,
    hasSecret: Boolean(row.ciphertext),
  };
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function sanitizeExtra(extra: Record<string, string> | null | undefined): Record<string, string> | null {
  if (!extra) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value !== "string") continue;
    if (/secret|api[_-]?key|token|password|authorization/i.test(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function toUsageRow(event: AiUsageEvent): AiUsageEventEntity {
  const row = new AiUsageEventEntity();
  row.id = randomUUID();
  row.productCode = event.productCode;
  row.subjectId = event.subjectId;
  row.organizationId = event.organizationId ?? null;
  row.conversationUid = event.conversationUid ?? null;
  row.feature = event.feature ?? null;
  row.purpose = event.purpose ?? null;
  row.providerType = event.providerType;
  row.model = event.model;
  row.promptTokens = event.promptTokens;
  row.completionTokens = event.completionTokens;
  row.audioInputMs = event.audioInputMs ?? null;
  row.audioOutputMs = event.audioOutputMs ?? null;
  row.latencyMs = event.latencyMs ?? null;
  row.firstTokenMs = event.firstTokenMs ?? null;
  row.cacheHit = event.cacheHit ?? null;
  row.routeTier = event.routeTier ?? null;
  row.estimatedCostMinor = event.estimatedCostMinor ?? null;
  row.billed = event.billed;
  row.status = event.status ?? null;
  row.traceId = event.traceId ?? null;
  row.at = new Date(event.at);
  row.walletId = event.walletId ?? null;
  row.grantIds = event.grantIds ?? null;
  row.rateCardId = event.rateCardId ?? null;
  row.rateCardVersion =
    event.rateCardVersion == null ? null : String(event.rateCardVersion);
  row.upstreamCostMicroUsd = event.upstreamCostMicroUsd ?? null;
  row.chargedMicro = event.chargedMicro ?? null;
  row.routeId = event.routeId ?? null;
  row.attemptIndex = event.attemptIndex ?? null;
  row.partial = event.partial ?? null;
  row.surface = event.surface ?? "product";
  row.apiKeyId = event.apiKeyId ?? null;
  return row;
}

function fromUsageRow(row: AiUsageEventEntity): AiUsageEvent {
  return {
    productCode: row.productCode,
    subjectId: row.subjectId,
    organizationId: row.organizationId,
    conversationUid: row.conversationUid ?? undefined,
    feature: row.feature ?? undefined,
    purpose: (row.purpose as AiUsageEvent["purpose"]) ?? undefined,
    providerType: row.providerType,
    model: row.model,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    audioInputMs: row.audioInputMs ?? undefined,
    audioOutputMs: row.audioOutputMs ?? undefined,
    billed: row.billed as AiUsageEvent["billed"],
    latencyMs: row.latencyMs ?? undefined,
    firstTokenMs: row.firstTokenMs ?? undefined,
    cacheHit: row.cacheHit ?? undefined,
    routeTier: row.routeTier ?? undefined,
    estimatedCostMinor: row.estimatedCostMinor ?? undefined,
    status: row.status ?? undefined,
    traceId: row.traceId ?? undefined,
    at: row.at.toISOString(),
    walletId: row.walletId,
    grantIds: row.grantIds,
    rateCardId: row.rateCardId,
    rateCardVersion: row.rateCardVersion,
    upstreamCostMicroUsd: row.upstreamCostMicroUsd,
    chargedMicro: row.chargedMicro,
    routeId: row.routeId,
    attemptIndex: row.attemptIndex,
    partial: row.partial,
    surface: (row.surface as AiUsageEvent["surface"]) ?? null,
    apiKeyId: row.apiKeyId,
  };
}

function billingFields(settlement: Settlement | null): Partial<AiUsageEvent> {
  if (!settlement) {
    return {
      walletId: null,
      grantIds: null,
      rateCardId: null,
      rateCardVersion: null,
      upstreamCostMicroUsd: null,
      chargedMicro: null,
      partial: null,
    };
  }
  return {
    walletId: settlement.walletId,
    grantIds: settlement.grantIds,
    rateCardId: settlement.rateCardId,
    rateCardVersion: settlement.rateCardVersion,
    upstreamCostMicroUsd: microToNumber(settlement.upstreamCostMicroUsd),
    chargedMicro: microToNumber(settlement.chargedMicro),
    partial: settlement.partial,
  };
}

function defaultCapability(purpose: "chat" | "stt" | "tts"): string {
  if (purpose === "chat") return "chat.text";
  if (purpose === "stt") return "stt";
  return "tts";
}

function estimateQuantities(
  purpose: "chat" | "stt" | "tts",
  body: {
    maxTokens?: number;
    messages?: AiCompleteMessage[];
    text?: string;
    speed?: number;
    audioInputMs?: number;
    audioOutputMs?: number;
  },
): UsageQuantities {
  if (purpose === "chat") {
    if (!body.maxTokens || !Number.isInteger(body.maxTokens) || body.maxTokens <= 0) {
      throw new AiPlatformException("VALIDATION_ERROR", 400, "maxTokens is required");
    }
    const chars = (body.messages ?? []).reduce((sum, message) => sum + (message.content?.length ?? 0), 0);
    return { promptTokens: Math.max(1, Math.ceil(chars / 4)), completionTokens: body.maxTokens };
  }
  if (purpose === "stt") return { audioInputMs: Math.max(1, body.audioInputMs ?? 1000) };
  return { audioOutputMs: Math.max(1, body.audioOutputMs ?? estimateTtsMs(body.text ?? "", body.speed)) };
}

function walletOwner(caller: { subjectId: string; organizationId: string | null }): {
  kind: OwnerKind;
  id: string;
} {
  if (caller.organizationId) return { kind: "organization", id: caller.organizationId };
  return { kind: "user", id: caller.subjectId };
}

function estimateAudioMs(audio: Buffer): number {
  return Math.max(1000, Math.round((audio.length / 16000) * 1000));
}

function estimateTtsMs(text: string, speed = 1): number {
  const words = Math.max(1, text.trim().split(/\s+/).length);
  return Math.round(((words / 2.5) * 1000) / Math.max(0.5, speed));
}

function estimateCost(input: {
  purpose: "chat" | "stt" | "tts";
  promptTokens?: number;
  completionTokens?: number;
  audioInputMs?: number;
  audioOutputMs?: number;
}): number {
  let rates: {
    llmPer1kTokensMinor?: number;
    sttPerAudioSecMinor?: number;
    ttsPerAudioSecMinor?: number;
  } = {};
  try {
    rates = JSON.parse(process.env.AI_VOICE_COST_RATES ?? "{}") as typeof rates;
  } catch {
    rates = {};
  }
  if (input.purpose === "chat") {
    const tokens = (input.promptTokens ?? 0) + (input.completionTokens ?? 0);
    return Math.round((tokens / 1000) * (rates.llmPer1kTokensMinor ?? 0));
  }
  if (input.purpose === "stt") {
    return Math.round(((input.audioInputMs ?? 0) / 1000) * (rates.sttPerAudioSecMinor ?? 0));
  }
  return Math.round(((input.audioOutputMs ?? 0) / 1000) * (rates.ttsPerAudioSecMinor ?? 0));
}
