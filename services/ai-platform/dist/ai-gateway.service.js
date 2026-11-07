"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiGatewayService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const ai_client_1 = require("@luminaryworks/ai-client");
const authz_1 = require("./authz");
const errors_1 = require("./common/errors");
const entities_1 = require("./database/entities");
const entitlement_gate_1 = require("./entitlement-gate");
const policy_1 = require("./policy");
const tts_cache_1 = require("./tts-cache");
const money_1 = require("./wallet/money");
const wallet_service_1 = require("./wallet/wallet.service");
let AiGatewayService = class AiGatewayService {
    connections;
    usage;
    entitlement;
    wallet;
    constructor(connections, usage, entitlement, wallet) {
        this.connections = connections;
        this.usage = usage;
        this.entitlement = entitlement;
        this.wallet = wallet;
    }
    async listConnections(principal) {
        const rows = await this.connections.find({ order: { createdAt: "ASC" } });
        const visible = principal.kind === "service" ? rows : rows.filter((row) => (0, authz_1.canManageConnection)(principal, row));
        return visible.map((row) => toPublic(row));
    }
    async upsertConnection(input, principal) {
        const uid = input.uid || `conn_${(0, node_crypto_1.randomUUID)()}`;
        const prev = await this.connections.findOne({ where: { uid } });
        if (prev)
            (0, authz_1.assertCanManageConnection)(principal, prev);
        (0, authz_1.assertCanManageConnection)(principal, { ownerKind: input.ownerKind, ownerUid: input.ownerUid });
        let ciphertext = prev?.ciphertext ?? null;
        let secretFingerprint = prev?.secretFingerprint ?? null;
        if (input.secret) {
            const masterKey = process.env.AI_VAULT_MASTER_KEY?.trim() ?? "";
            if (!masterKey) {
                throw new errors_1.AiPlatformException("VAULT_UNAVAILABLE", 503, "AI_VAULT_MASTER_KEY missing");
            }
            ciphertext = (0, ai_client_1.encryptSecret)(masterKey, input.secret);
            secretFingerprint = (0, ai_client_1.fingerprintSecret)(input.secret);
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
    async recordUsage(event) {
        await this.usage.save(toUsageRow(event));
    }
    async listUsage(principal) {
        const rows = await this.usage.find({
            where: principal.kind === "user" ? { subjectId: principal.subjectId } : {},
            order: { at: "DESC" },
            take: 200,
        });
        return rows.reverse().map(fromUsageRow);
    }
    async complete(body, opts) {
        const started = Date.now();
        const creds = await this.prepare(body, { ...opts, purpose: "chat" });
        const caller = creds.caller;
        const reservation = await this.beginManagedBill(creds, "chat", body);
        let result;
        try {
            result = await (0, ai_client_1.completeLocal)({
                providerType: creds.providerType,
                baseUrl: creds.baseUrl,
                model: creds.model,
                secret: creds.secret,
                messages: body.messages,
                jsonMode: Boolean(body.jsonSchema),
                maxTokens: body.maxTokens,
            });
        }
        catch (error) {
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
    async openStream(body, opts) {
        const creds = await this.prepare(body, { ...opts, purpose: "chat" });
        const reservation = await this.beginManagedBill(creds, "chat", body);
        let events;
        try {
            events = (0, ai_client_1.streamLocal)({
                providerType: creds.providerType,
                baseUrl: creds.baseUrl,
                model: creds.model,
                secret: creds.secret,
                messages: body.messages,
            });
        }
        catch (error) {
            await this.abortManagedBill(reservation);
            throw error;
        }
        return this.finishStream(events, reservation, creds, body, opts.surface ?? "product");
    }
    embed(texts) {
        const dim = 16;
        const vectors = texts.map((text) => {
            const out = new Array(dim).fill(0);
            const hash = (0, node_crypto_1.createHash)("sha256").update(text).digest();
            for (let i = 0; i < dim; i++)
                out[i] = (hash[i] ?? 0) / 255;
            return out;
        });
        return {
            vectors,
            model: "sha256-16",
            usage: { promptTokens: texts.join(" ").length, completionTokens: 0 },
            traceId: `trc_emb_${(0, node_crypto_1.randomUUID)()}`,
        };
    }
    async transcribe(body, opts) {
        const started = Date.now();
        const audio = Buffer.from(body.audioBase64 ?? "", "base64");
        if (!audio.length)
            throw new Error("audioBase64 required");
        const creds = await this.prepare(body, { ...opts, purpose: "stt" });
        const audioInputMs = body.audioInputMs ?? estimateAudioMs(audio);
        const reservation = await this.beginManagedBill(creds, "stt", { ...body, audioInputMs });
        let result;
        try {
            result = await (0, ai_client_1.transcribeLocal)({
                providerType: creds.providerType,
                baseUrl: creds.baseUrl,
                model: creds.model,
                secret: creds.secret,
                audio,
                mime: body.mime,
                language: body.language,
            });
        }
        catch (error) {
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
    async synthesize(body, opts) {
        const started = Date.now();
        const creds = await this.prepare(body, { ...opts, purpose: "tts" });
        const key = (0, ai_client_1.ttsCacheKey)({
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
            result = await (0, ai_client_1.synthesizeLocal)({
                providerType: creds.providerType,
                baseUrl: creds.baseUrl,
                model: creds.model,
                secret: creds.secret,
                text: body.text,
                voice: body.voice,
            });
        }
        catch (error) {
            await this.abortManagedBill(reservation);
            throw error;
        }
        (0, tts_cache_1.writeTtsCache)(key, { audioBase64: result.audioBase64, mime: result.mime });
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
    async prepare(body, opts) {
        const caller = (0, authz_1.bindCaller)(opts.principal, body);
        const hasSecret = Boolean(body.ephemeral?.secret);
        if (!(0, policy_1.ephemeralSecretAllowed)({
            production: (0, policy_1.isProductionEnv)(),
            allowEphemeral: opts.allowEphemeral === true,
            hasSecret,
        })) {
            throw new errors_1.AiPlatformException("EPHEMERAL_NOT_ALLOWED", 400, "ephemeral secrets are only allowed on POST /v1/providers/test in production");
        }
        const creds = hasSecret
            ? {
                providerType: body.ephemeral.providerType,
                model: body.ephemeral.model,
                baseUrl: body.ephemeral.baseUrl,
                secret: body.ephemeral.secret,
                routeTier: body.routeTier ?? "standard",
                connectionUid: body.connectionUid,
                ownerKind: null,
                ephemeral: true,
            }
            : await this.resolveSaved(body.connectionUid, opts.purpose, body.routeTier, opts.principal);
        const byok = (0, policy_1.isByokPath)({
            ephemeral: creds.ephemeral,
            providerType: creds.providerType,
            ownerKind: creds.ownerKind,
        });
        if (!byok)
            (0, authz_1.assertHostedCaller)(opts.principal);
        const productCode = (0, authz_1.assertInferenceProduct)(opts.principal, body.productCode);
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
    async beginManagedBill(creds, purpose, body) {
        if (!(0, policy_1.readWalletEnforce)() || creds.byok)
            return null;
        const requestId = body.idempotencyKey?.trim() ?? "";
        if (!requestId)
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "idempotencyKey is required");
        const capability = body.capability?.trim() || defaultCapability(purpose);
        const usage = estimateQuantities(purpose, body);
        const quote = await this.wallet.quote({
            capability,
            providerType: creds.providerType,
            model: creds.model,
            usage,
        });
        if (quote.chargedMicro <= 0n) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "rate card priced the request at zero");
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
    async finishManagedBill(reservation, creds, usage) {
        if (!reservation)
            return null;
        return this.wallet.settle({
            requestId: reservation.requestId,
            capability: reservation.capability,
            providerType: creds.providerType,
            model: creds.model,
            usage,
        });
    }
    async abortManagedBill(reservation) {
        if (!reservation)
            return;
        await this.wallet.release(reservation.requestId).catch(() => undefined);
    }
    async *finishStream(events, reservation, creds, body, surface) {
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
            if (!reservation)
                return;
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
        }
        finally {
            if (reservation && !upstreamDone)
                await this.abortManagedBill(reservation);
        }
    }
    async resolveSaved(connectionUid, purpose, routeTier, principal) {
        const row = await this.pickConnection(connectionUid, purpose, routeTier, principal);
        if (!row?.ciphertext)
            throw new Error("connection not found");
        (0, authz_1.assertCanUseConnection)(principal, row);
        const masterKey = process.env.AI_VAULT_MASTER_KEY?.trim() ?? "";
        if (!masterKey) {
            throw new errors_1.AiPlatformException("VAULT_UNAVAILABLE", 503, "AI_VAULT_MASTER_KEY missing");
        }
        return {
            providerType: row.providerType,
            model: row.model,
            baseUrl: row.baseUrl ?? undefined,
            secret: (0, ai_client_1.decryptSecret)(masterKey, row.ciphertext),
            routeTier: row.extra?.routeTier ?? routeTier ?? "standard",
            connectionUid: row.uid,
            ownerKind: row.ownerKind,
            ephemeral: false,
        };
    }
    async pickConnection(connectionUid, purpose, routeTier, principal) {
        if (connectionUid)
            return this.connections.findOne({ where: { uid: connectionUid } });
        const wantedTier = (routeTier ?? "standard").toLowerCase();
        const enabled = (await this.connections.find({ where: { enabled: true } })).filter((row) => {
            if (!row.ciphertext)
                return false;
            if (principal.kind === "service")
                return row.ownerKind === "deployment";
            return (0, authz_1.canManageConnection)(principal, row);
        });
        const byPurpose = enabled.filter((row) => (0, ai_client_1.connectionHasPurpose)(row.purpose, purpose));
        const pool = byPurpose.length > 0 ? byPurpose : enabled;
        const byTier = pool.filter((row) => (row.extra?.routeTier ?? "standard").toLowerCase() === wantedTier);
        const ranked = (byTier.length > 0 ? byTier : pool).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
        return ranked[0] ?? null;
    }
};
exports.AiGatewayService = AiGatewayService;
exports.AiGatewayService = AiGatewayService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.ProviderConnectionEntity)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.AiUsageEventEntity)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        entitlement_gate_1.EntitlementGate,
        wallet_service_1.WalletService])
], AiGatewayService);
function toPublic(row) {
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
function toUsageRow(event) {
    const row = new entities_1.AiUsageEventEntity();
    row.id = (0, node_crypto_1.randomUUID)();
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
function fromUsageRow(row) {
    return {
        productCode: row.productCode,
        subjectId: row.subjectId,
        organizationId: row.organizationId,
        conversationUid: row.conversationUid ?? undefined,
        feature: row.feature ?? undefined,
        purpose: row.purpose ?? undefined,
        providerType: row.providerType,
        model: row.model,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        audioInputMs: row.audioInputMs ?? undefined,
        audioOutputMs: row.audioOutputMs ?? undefined,
        billed: row.billed,
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
        surface: row.surface ?? null,
        apiKeyId: row.apiKeyId,
    };
}
function billingFields(settlement) {
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
        upstreamCostMicroUsd: (0, money_1.microToNumber)(settlement.upstreamCostMicroUsd),
        chargedMicro: (0, money_1.microToNumber)(settlement.chargedMicro),
        partial: settlement.partial,
    };
}
function defaultCapability(purpose) {
    if (purpose === "chat")
        return "chat.text";
    if (purpose === "stt")
        return "stt";
    return "tts";
}
function estimateQuantities(purpose, body) {
    if (purpose === "chat") {
        if (!body.maxTokens || !Number.isInteger(body.maxTokens) || body.maxTokens <= 0) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "maxTokens is required");
        }
        const chars = (body.messages ?? []).reduce((sum, message) => sum + (message.content?.length ?? 0), 0);
        return { promptTokens: Math.max(1, Math.ceil(chars / 4)), completionTokens: body.maxTokens };
    }
    if (purpose === "stt")
        return { audioInputMs: Math.max(1, body.audioInputMs ?? 1000) };
    return { audioOutputMs: Math.max(1, body.audioOutputMs ?? estimateTtsMs(body.text ?? "", body.speed)) };
}
function walletOwner(caller) {
    if (caller.organizationId)
        return { kind: "organization", id: caller.organizationId };
    return { kind: "user", id: caller.subjectId };
}
function estimateAudioMs(audio) {
    return Math.max(1000, Math.round((audio.length / 16000) * 1000));
}
function estimateTtsMs(text, speed = 1) {
    const words = Math.max(1, text.trim().split(/\s+/).length);
    return Math.round(((words / 2.5) * 1000) / Math.max(0.5, speed));
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
