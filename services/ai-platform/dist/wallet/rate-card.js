"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RATE_UNITS = void 0;
exports.markedUpMicro = markedUpMicro;
exports.isRateUnit = isRateUnit;
exports.priceUsage = priceUsage;
const money_1 = require("./money");
exports.RATE_UNITS = [
    "1k_input_tokens",
    "1k_output_tokens",
    "1k_cached_input_tokens",
    "audio_second_in",
    "audio_second_out",
    "image",
    "assessment",
    "video_second",
];
const TOKEN_DIVISOR = 1000n;
const MILLISECOND_DIVISOR = 1000n;
function markedUpMicro(upstream, markupBps) {
    if (!Number.isInteger(markupBps) || markupBps < 0) {
        throw new Error("markupBps must be a non-negative integer");
    }
    return (0, money_1.ceilDiv)(upstream * BigInt(10_000 + markupBps), 10000n);
}
function isRateUnit(value) {
    return exports.RATE_UNITS.includes(value);
}
/**
 * Fixture and published cards are the only prices. Missing cached/reasoning
 * rows fall back to the most expensive line for that capability+provider+model
 * (spec §6). Other missing units are an error.
 */
function priceUsage(card, capability, providerType, model, usage) {
    let charged = 0n;
    let upstream = 0n;
    let usedFallback = false;
    const dims = [
        { unit: "1k_input_tokens", quantity: BigInt(usage.promptTokens ?? 0), divisor: TOKEN_DIVISOR },
        { unit: "1k_output_tokens", quantity: BigInt(usage.completionTokens ?? 0), divisor: TOKEN_DIVISOR },
        {
            unit: "1k_cached_input_tokens",
            quantity: BigInt(usage.cachedPromptTokens ?? 0),
            divisor: TOKEN_DIVISOR,
        },
        { unit: "reasoning", quantity: BigInt(usage.reasoningTokens ?? 0), divisor: TOKEN_DIVISOR },
        { unit: "audio_second_in", quantity: BigInt(usage.audioInputMs ?? 0), divisor: MILLISECOND_DIVISOR },
        { unit: "audio_second_out", quantity: BigInt(usage.audioOutputMs ?? 0), divisor: MILLISECOND_DIVISOR },
        { unit: "image", quantity: BigInt(usage.images ?? 0), divisor: 1n },
        { unit: "assessment", quantity: BigInt(usage.assessments ?? 0), divisor: 1n },
        { unit: "video_second", quantity: BigInt(usage.videoSeconds ?? 0), divisor: 1n },
    ];
    for (const dim of dims) {
        if (dim.quantity <= 0n)
            continue;
        const resolved = resolveLine(card.lines, capability, providerType, model, dim.unit);
        usedFallback = usedFallback || resolved.fallback;
        const marked = markedUpMicro(resolved.line.upstreamCostMicroUsd, resolved.line.markupBps);
        charged += (0, money_1.ceilDiv)(dim.quantity * marked, dim.divisor) + resolved.line.fixedFeeMicro;
        upstream += (0, money_1.ceilDiv)(dim.quantity * resolved.line.upstreamCostMicroUsd, dim.divisor);
    }
    return {
        chargedMicro: charged,
        upstreamCostMicroUsd: upstream,
        usedFallback,
        rateCardId: card.id,
        rateCardVersion: card.version,
    };
}
function resolveLine(lines, capability, providerType, model, unit) {
    if (unit !== "reasoning") {
        const exact = findLine(lines, capability, providerType, model, unit);
        if (exact)
            return { line: exact, fallback: false };
        if (unit !== "1k_cached_input_tokens") {
            throw new Error(`rate card has no line for ${capability}/${providerType}/${model}/${unit}`);
        }
    }
    const pool = lines.filter((line) => line.capability === capability && line.providerType === providerType && line.model === model);
    if (pool.length === 0) {
        throw new Error(`rate card has no line for ${capability}/${providerType}/${model}`);
    }
    const line = pool.reduce((best, line) => markedUpMicro(line.upstreamCostMicroUsd, line.markupBps) >
        markedUpMicro(best.upstreamCostMicroUsd, best.markupBps)
        ? line
        : best);
    return { line, fallback: true };
}
function findLine(lines, capability, providerType, model, unit) {
    return (lines.find((line) => line.capability === capability &&
        line.providerType === providerType &&
        line.model === model &&
        line.unit === unit) ??
        lines.find((line) => line.capability === capability &&
            line.providerType === providerType &&
            line.model === "*" &&
            line.unit === unit));
}
