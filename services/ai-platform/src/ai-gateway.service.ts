import { Injectable, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
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
} from "../../../shared/packages/ai-client/dist/index";
import { loadConnections, saveConnections, type ProviderConnection } from "./connection-store";
import { readTtsCache, writeTtsCache } from "./tts-cache";

export type { ProviderConnection };

const usageLog: AiUsageEvent[] = [];

@Injectable()
export class AiGatewayService implements OnModuleInit {
  private connections = new Map<string, ProviderConnection>();

  onModuleInit(): void {
    this.connections = loadConnections();
  }

  private persist(): void {
    saveConnections(this.connections.values());
  }

  private masterKey(): string {
    const key = process.env.AI_VAULT_MASTER_KEY ?? "";
    if (!key.trim()) throw new Error("AI_VAULT_MASTER_KEY missing");
    return key;
  }

  listConnections() {
    return [...this.connections.values()].map(({ ciphertext: _c, ...rest }) => rest);
  }

  upsertConnection(input: {
    uid?: string;
    ownerKind: ProviderConnection["ownerKind"];
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
  }): ProviderConnection {
    const uid = input.uid || `conn_${randomUUID()}`;
    const prev = this.connections.get(uid);
    let ciphertext = prev?.ciphertext;
    let secretFingerprint = prev?.secretFingerprint;
    if (input.secret) {
      ciphertext = encryptSecret(this.masterKey(), input.secret);
      secretFingerprint = fingerprintSecret(input.secret);
    }
    const row: ProviderConnection = {
      uid,
      ownerKind: input.ownerKind,
      ownerUid: input.ownerUid,
      providerType: input.providerType,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      model: input.model,
      enabled: input.enabled ?? true,
      isDefault: input.isDefault ?? prev?.isDefault ?? false,
      purpose: input.purpose ?? prev?.purpose ?? "chat",
      extra: input.extra ?? prev?.extra ?? null,
      secretFingerprint,
      ciphertext,
    };
    this.connections.set(uid, row);
    this.persist();
    const { ciphertext: _c, ...safe } = row;
    return safe;
  }

  resolveSecret(
    connectionUid?: string,
    ephemeral?: { secret: string; providerType: string; model: string; baseUrl?: string },
    purpose: "chat" | "stt" | "tts" = "chat",
    routeTier?: string,
  ) {
    if (ephemeral?.secret) {
      return {
        providerType: ephemeral.providerType,
        model: ephemeral.model,
        baseUrl: ephemeral.baseUrl,
        secret: ephemeral.secret,
        routeTier: routeTier ?? "standard",
        connectionUid: connectionUid,
      };
    }
    const row = this.pickConnection(connectionUid, purpose, routeTier);
    if (!row?.ciphertext) throw new Error("connection not found");
    return {
      providerType: row.providerType,
      model: row.model,
      baseUrl: row.baseUrl,
      secret: decryptSecret(this.masterKey(), row.ciphertext),
      routeTier: row.extra?.routeTier ?? routeTier ?? "standard",
      connectionUid: row.uid,
    };
  }

  private pickConnection(
    connectionUid?: string,
    purpose: "chat" | "stt" | "tts" = "chat",
    routeTier?: string,
  ): ProviderConnection | undefined {
    if (connectionUid) return this.connections.get(connectionUid);
    const wantedTier = (routeTier ?? "standard").toLowerCase();
    const enabled = [...this.connections.values()].filter((row) => row.enabled && row.ciphertext);
    const byPurpose = enabled.filter((row) => connectionHasPurpose(row.purpose, purpose));
    const pool = byPurpose.length > 0 ? byPurpose : enabled;
    const byTier = pool.filter((row) => (row.extra?.routeTier ?? "standard").toLowerCase() === wantedTier);
    const ranked = (byTier.length > 0 ? byTier : pool).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    return ranked[0];
  }

  recordUsage(event: AiUsageEvent) {
    usageLog.push(event);
    if (usageLog.length > 5000) usageLog.shift();
  }

  listUsage() {
    return usageLog.slice(-200);
  }

  async complete(body: {
    connectionUid?: string;
    ephemeral?: { providerType: string; model: string; secret: string; baseUrl?: string };
    messages: AiCompleteMessage[];
    jsonSchema?: Record<string, unknown>;
    maxTokens?: number;
    productCode?: string;
    subjectId?: string;
    routeTier?: string;
  }) {
    const started = Date.now();
    const creds = this.resolveSecret(body.connectionUid, body.ephemeral, "chat", body.routeTier);
    const result = await completeLocal({
      providerType: creds.providerType,
      baseUrl: creds.baseUrl,
      model: creds.model,
      secret: creds.secret,
      messages: body.messages,
      jsonMode: Boolean(body.jsonSchema),
      maxTokens: body.maxTokens,
    });
    this.recordUsage({
      productCode: body.productCode || "unknown",
      subjectId: body.subjectId || "anonymous",
      purpose: "chat",
      providerType: result.providerType,
      model: result.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      billed: body.ephemeral?.secret ? "byok" : "managed",
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
    });
    return result;
  }

  stream(body: {
    connectionUid?: string;
    ephemeral?: { providerType: string; model: string; secret: string; baseUrl?: string };
    messages: AiCompleteMessage[];
    routeTier?: string;
  }) {
    const creds = this.resolveSecret(body.connectionUid, body.ephemeral, "chat", body.routeTier);
    return streamLocal({
      providerType: creds.providerType,
      baseUrl: creds.baseUrl,
      model: creds.model,
      secret: creds.secret,
      messages: body.messages,
    });
  }

  embed(texts: string[]) {
    const dim = 16;
    const vectors = texts.map((t) => {
      const out = new Array<number>(dim).fill(0);
      const h = createHash("sha256").update(t).digest();
      for (let i = 0; i < dim; i++) out[i] = h[i] / 255;
      return out;
    });
    return {
      vectors,
      model: "sha256-16",
      usage: { promptTokens: texts.join(" ").length, completionTokens: 0 },
      traceId: `trc_emb_${randomUUID()}`,
    };
  }

  async transcribe(body: {
    connectionUid?: string;
    ephemeral?: { providerType: string; model: string; secret: string; baseUrl?: string };
    audioBase64?: string;
    mime?: string;
    language?: string;
    productCode?: string;
    subjectId?: string;
    routeTier?: string;
    audioInputMs?: number;
  }) {
    const started = Date.now();
    const audio = Buffer.from(body.audioBase64 ?? "", "base64");
    if (!audio.length) throw new Error("audioBase64 required");
    const creds = this.resolveSecret(body.connectionUid, body.ephemeral, "stt", body.routeTier);
    const result = await transcribeLocal({
      providerType: creds.providerType,
      baseUrl: creds.baseUrl,
      model: creds.model,
      secret: creds.secret,
      audio,
      mime: body.mime,
      language: body.language,
    });
    const audioInputMs = body.audioInputMs ?? estimateAudioMs(audio);
    this.recordUsage({
      productCode: body.productCode || "unknown",
      subjectId: body.subjectId || "anonymous",
      purpose: "stt",
      providerType: result.providerType,
      model: result.model,
      promptTokens: 0,
      completionTokens: 0,
      audioInputMs,
      billed: body.ephemeral?.secret ? "byok" : "managed",
      latencyMs: Date.now() - started,
      routeTier: creds.routeTier,
      estimatedCostMinor: estimateCost({ purpose: "stt", audioInputMs }),
      status: "ok",
      traceId: result.traceId,
      at: new Date().toISOString(),
    });
    return { ...result, audioInputMs };
  }

  async synthesize(body: {
    connectionUid?: string;
    ephemeral?: { providerType: string; model: string; secret: string; baseUrl?: string };
    text: string;
    voice?: string;
    locale?: string;
    speed?: number;
    productCode?: string;
    subjectId?: string;
    routeTier?: string;
  }) {
    const started = Date.now();
    const creds = this.resolveSecret(body.connectionUid, body.ephemeral, "tts", body.routeTier);
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
      this.recordUsage({
        productCode: body.productCode || "unknown",
        subjectId: body.subjectId || "anonymous",
        purpose: "tts",
        providerType: creds.providerType,
        model: creds.model,
        promptTokens: 0,
        completionTokens: 0,
        audioOutputMs,
        billed: body.ephemeral?.secret ? "byok" : "managed",
        latencyMs: Date.now() - started,
        cacheHit: true,
        routeTier: creds.routeTier,
        estimatedCostMinor: 0,
        status: "ok",
        traceId: `trc_tts_cache_${key.slice(0, 12)}`,
        at: new Date().toISOString(),
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
    const result = await synthesizeLocal({
      providerType: creds.providerType,
      baseUrl: creds.baseUrl,
      model: creds.model,
      secret: creds.secret,
      text: body.text,
      voice: body.voice,
    });
    writeTtsCache(key, { audioBase64: result.audioBase64, mime: result.mime });
    const audioOutputMs = estimateTtsMs(body.text, body.speed);
    this.recordUsage({
      productCode: body.productCode || "unknown",
      subjectId: body.subjectId || "anonymous",
      purpose: "tts",
      providerType: result.providerType,
      model: result.model,
      promptTokens: 0,
      completionTokens: 0,
      audioOutputMs,
      billed: body.ephemeral?.secret ? "byok" : "managed",
      latencyMs: Date.now() - started,
      cacheHit: false,
      routeTier: creds.routeTier,
      estimatedCostMinor: estimateCost({ purpose: "tts", audioOutputMs }),
      status: "ok",
      traceId: result.traceId,
      at: new Date().toISOString(),
    });
    return { ...result, audioOutputMs, cacheHit: false };
  }
}

function estimateAudioMs(audio: Buffer): number {
  return Math.max(1000, Math.round((audio.length / 16000) * 1000));
}

function estimateTtsMs(text: string, speed = 1): number {
  const words = Math.max(1, text.trim().split(/\s+/).length);
  return Math.round((words / 2.5) * 1000 / Math.max(0.5, speed));
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
