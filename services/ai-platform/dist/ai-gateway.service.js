"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiGatewayService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const index_1 = require("../../../shared/packages/ai-client/dist/index");
const connection_store_1 = require("./connection-store");
const tts_cache_1 = require("./tts-cache");
const usageLog = [];
let AiGatewayService = class AiGatewayService {
    connections = new Map();
    onModuleInit() {
        this.connections = (0, connection_store_1.loadConnections)();
    }
    persist() {
        (0, connection_store_1.saveConnections)(this.connections.values());
    }
    masterKey() {
        const key = process.env.AI_VAULT_MASTER_KEY ?? "";
        if (!key.trim())
            throw new Error("AI_VAULT_MASTER_KEY missing");
        return key;
    }
    listConnections() {
        return [...this.connections.values()].map(({ ciphertext: _c, ...rest }) => rest);
    }
    upsertConnection(input) {
        const uid = input.uid || `conn_${(0, node_crypto_1.randomUUID)()}`;
        const prev = this.connections.get(uid);
        let ciphertext = prev?.ciphertext;
        let secretFingerprint = prev?.secretFingerprint;
        if (input.secret) {
            ciphertext = (0, index_1.encryptSecret)(this.masterKey(), input.secret);
            secretFingerprint = (0, index_1.fingerprintSecret)(input.secret);
        }
        const row = {
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
    resolveSecret(connectionUid, ephemeral, purpose = "chat", routeTier) {
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
        if (!row?.ciphertext)
            throw new Error("connection not found");
        return {
            providerType: row.providerType,
            model: row.model,
            baseUrl: row.baseUrl,
            secret: (0, index_1.decryptSecret)(this.masterKey(), row.ciphertext),
            routeTier: row.extra?.routeTier ?? routeTier ?? "standard",
            connectionUid: row.uid,
        };
    }
    pickConnection(connectionUid, purpose = "chat", routeTier) {
        if (connectionUid)
            return this.connections.get(connectionUid);
        const wantedTier = (routeTier ?? "standard").toLowerCase();
        const enabled = [...this.connections.values()].filter((row) => row.enabled && row.ciphertext);
        const byPurpose = enabled.filter((row) => (0, index_1.connectionHasPurpose)(row.purpose, purpose));
        const pool = byPurpose.length > 0 ? byPurpose : enabled;
        const byTier = pool.filter((row) => (row.extra?.routeTier ?? "standard").toLowerCase() === wantedTier);
        const ranked = (byTier.length > 0 ? byTier : pool).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
        return ranked[0];
    }
    recordUsage(event) {
        usageLog.push(event);
        if (usageLog.length > 5000)
            usageLog.shift();
    }
    listUsage() {
        return usageLog.slice(-200);
    }
    async complete(body) {
        const started = Date.now();
        const creds = this.resolveSecret(body.connectionUid, body.ephemeral, "chat", body.routeTier);
        const result = await (0, index_1.completeLocal)({
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
    stream(body) {
        const creds = this.resolveSecret(body.connectionUid, body.ephemeral, "chat", body.routeTier);
        return (0, index_1.streamLocal)({
            providerType: creds.providerType,
            baseUrl: creds.baseUrl,
            model: creds.model,
            secret: creds.secret,
            messages: body.messages,
        });
    }
    embed(texts) {
        const dim = 16;
        const vectors = texts.map((t) => {
            const out = new Array(dim).fill(0);
            const h = (0, node_crypto_1.createHash)("sha256").update(t).digest();
            for (let i = 0; i < dim; i++)
                out[i] = h[i] / 255;
            return out;
        });
        return {
            vectors,
            model: "sha256-16",
            usage: { promptTokens: texts.join(" ").length, completionTokens: 0 },
            traceId: `trc_emb_${(0, node_crypto_1.randomUUID)()}`,
        };
    }
    async transcribe(body) {
        const started = Date.now();
        const audio = Buffer.from(body.audioBase64 ?? "", "base64");
        if (!audio.length)
            throw new Error("audioBase64 required");
        const creds = this.resolveSecret(body.connectionUid, body.ephemeral, "stt", body.routeTier);
        const result = await (0, index_1.transcribeLocal)({
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
    async synthesize(body) {
        const started = Date.now();
        const creds = this.resolveSecret(body.connectionUid, body.ephemeral, "tts", body.routeTier);
        const key = (0, index_1.ttsCacheKey)({
            providerType: creds.providerType,
            model: creds.model,
            voice: body.voice,
            locale: body.locale,
            speed: body.speed,
            text: body.text,
        });
        const cached = (0, tts_cache_1.readTtsCache)(key);
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
        const result = await (0, index_1.synthesizeLocal)({
            providerType: creds.providerType,
            baseUrl: creds.baseUrl,
            model: creds.model,
            secret: creds.secret,
            text: body.text,
            voice: body.voice,
        });
        (0, tts_cache_1.writeTtsCache)(key, { audioBase64: result.audioBase64, mime: result.mime });
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
};
exports.AiGatewayService = AiGatewayService;
exports.AiGatewayService = AiGatewayService = __decorate([
    (0, common_1.Injectable)()
], AiGatewayService);
function estimateAudioMs(audio) {
    return Math.max(1000, Math.round((audio.length / 16000) * 1000));
}
function estimateTtsMs(text, speed = 1) {
    const words = Math.max(1, text.trim().split(/\s+/).length);
    return Math.round((words / 2.5) * 1000 / Math.max(0.5, speed));
}
function estimateCost(input) {
    let rates = {};
    try {
        rates = JSON.parse(process.env.AI_VOICE_COST_RATES ?? "{}");
    }
    catch {
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
