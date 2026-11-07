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
  streamLocal,
  synthesizeLocal,
  transcribeLocal,
  ttsCacheKey,
  type AiCompleteMessage,
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
import { AiUsageEventEntity, ProviderConnectionEntity } from "./database/entities";
import type { ConnectionOwnerKind } from "./database/entities/provider-connection.entity";
import { EntitlementGate } from "./entitlement-gate";
import { ephemeralSecretAllowed, isByokPath, isProductionEnv, readWalletEnforce } from "./policy";
import { readTtsCache, writeTtsCache } from "./tts-cache";
import { microToNumber } from "./wallet/money";
import type { UsageQuantities } from "./wallet/rate-card";
import { WalletService, type OwnerKind, type Settlement } from "./wallet/wallet.service";

export interface ProviderConnectionPublic {
  uid: string;
  ownerKind: ConnectionOwnerKind;
  ownerUid: string;
  providerType: string;
  displayName: string;
  baseUrl?: string;
  model: string;
  enabled: boolean;
  isDefault?: boolean;
  purpose?: string | null;
  extra?: Record<string, string> | null;
  secretFingerprint?: string;
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
}

interface ManagedReservation {
  requestId: string;
  capability: string;
}

@Injectable()
export class AiGatewayService {
  constructor(
    @InjectRepository(ProviderConnectionEntity)
    private readonly connections: Repository<ProviderConnectionEntity>,
    @InjectRepository(AiUsageEventEntity)
    private readonly usage: Repository<AiUsageEventEntity>,
    private readonly entitlement: EntitlementGate,
    private readonly wallet: WalletService,
  ) {}

  async listConnections(principal: AiPrincipal): Promise<ProviderConnectionPublic[]> {
    const rows = await this.connections.find({ order: { createdAt: "ASC" } });
    const visible =
      principal.kind === "service" ? rows : rows.filter((row) => canManageConnection(principal, row));
    return visible.map((row) => toPublic(row));
  }

  async upsertConnection(input: {
    uid?: string;
    ownerKind: ConnectionOwnerKind;
    ownerUid: string;
    providerType: string;
    displayName: string;
    baseUrl?: string;
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
    let ciphertext = prev?.ciphertext ?? null;
    let secretFingerprint = prev?.secretFingerprint ?? null;
    if (input.secret) {
      const masterKey = process.env.AI_VAULT_MASTER_KEY?.trim() ?? "";
      if (!masterKey) {
        throw new AiPlatformException("VAULT_UNAVAILABLE", 503, "AI_VAULT_MASTER_KEY missing");
      }
      ciphertext = encryptSecret(masterKey, input.secret);
      secretFingerprint = fingerprintSecret(input.secret);
    }
    const row = this.connections.create({
      uid,
      ownerKind: input.ownerKind,
      ownerUid: input.ownerUid,
      providerType: input.providerType,
      displayName: input.displayName,
      baseUrl: input.baseUrl ?? null,
      model: input.model,
      enabled: input.enabled ?? true,
      isDefault: input.isDefault ?? prev?.isDefault ?? false,
      purpose: input.purpose ?? prev?.purpose ?? "chat",
      extra: input.extra ?? prev?.extra ?? null,
      secretFingerprint,
      ciphertext,
    });
    const saved = await this.connections.save(row);
    return toPublic(saved);
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
      result = await completeLocal({
        providerType: creds.providerType,
        baseUrl: creds.baseUrl,
        model: creds.model,
        secret: creds.secret,
        messages: body.messages,
        jsonMode: Boolean(body.jsonSchema),
        maxTokens: body.maxTokens,
      });
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
    return this.finishStream(events, reservation, creds, body, opts.surface ?? "product");
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
      result = await transcribeLocal({
        providerType: creds.providerType,
        baseUrl: creds.baseUrl,
        model: creds.model,
        secret: creds.secret,
        audio,
        mime: body.mime,
        language: body.language,
      });
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
      result = await synthesizeLocal({
        providerType: creds.providerType,
        baseUrl: creds.baseUrl,
        model: creds.model,
        secret: creds.secret,
        text: body.text,
        voice: body.voice,
      });
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
        "ephemeral secrets are only allowed on POST /v1/providers/test in production",
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
    if (!byok) {
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
    if (!readWalletEnforce() || creds.byok) return null;
    const requestId = body.idempotencyKey?.trim() ?? "";
    if (!requestId) throw new AiPlatformException("VALIDATION_ERROR", 400, "idempotencyKey is required");
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
    const owner = walletOwner(creds.caller);
    const wallet = await this.wallet.ensureWallet(owner.kind, owner.id);
    await this.wallet.reserve({
      requestId,
      walletId: wallet.walletId,
      estimateMicro: quote.chargedMicro,
      productCode: creds.productCode,
      capability,
    });
    return { requestId, capability };
  }

  private async finishManagedBill(
    reservation: ManagedReservation | null,
    creds: ResolvedCall,
    usage: UsageQuantities,
  ): Promise<Settlement | null> {
    if (!reservation) return null;
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
        billed: "managed",
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
    if (!row?.ciphertext) throw new Error("connection not found");
    assertCanUseConnection(principal, row);
    const masterKey = process.env.AI_VAULT_MASTER_KEY?.trim() ?? "";
    if (!masterKey) {
      throw new AiPlatformException("VAULT_UNAVAILABLE", 503, "AI_VAULT_MASTER_KEY missing");
    }
    return {
      providerType: row.providerType,
      model: row.model,
      baseUrl: row.baseUrl ?? undefined,
      secret: decryptSecret(masterKey, row.ciphertext),
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
}

function toPublic(row: ProviderConnectionEntity): ProviderConnectionPublic {
  return {
    uid: row.uid,
    ownerKind: row.ownerKind,
    ownerUid: row.ownerUid,
    providerType: row.providerType,
    displayName: row.displayName,
    baseUrl: row.baseUrl ?? undefined,
    model: row.model,
    enabled: row.enabled,
    isDefault: row.isDefault,
    purpose: row.purpose,
    extra: row.extra,
    secretFingerprint: row.secretFingerprint ?? undefined,
  };
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
