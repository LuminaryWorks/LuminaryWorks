/**
 * In-memory token bucket for POST /v1/providers/test and POST /v1/providers/models.
 *
 * One bucket per principal (`user:<sub>` or `service:<sub>`). It is process-local:
 * a second replica or a restart starts empty. Default capacity is 20 tokens,
 * refilled at 0.5 tokens/second (about 30 probes/minute sustained, with a short burst).
 *
 * AI_PLATFORM_PROBE_RATE_CAPACITY
 * AI_PLATFORM_PROBE_RATE_REFILL_PER_SEC
 * AI_PLATFORM_PROBE_TIMEOUT_MS — upstream probe budget, default 4000
 */

export interface ProbeRateConfig {
  capacity: number;
  refillPerSec: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export function readProbeRateConfig(env: NodeJS.ProcessEnv = process.env): ProbeRateConfig {
  return {
    capacity: positiveNumber(env.AI_PLATFORM_PROBE_RATE_CAPACITY, 20),
    refillPerSec: positiveNumber(env.AI_PLATFORM_PROBE_RATE_REFILL_PER_SEC, 0.5),
  };
}

export function readProbeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveNumber(env.AI_PLATFORM_PROBE_TIMEOUT_MS, 4000);
}

export function probeRateKey(principal: { kind: string; subjectId: string }): string {
  return `${principal.kind}:${principal.subjectId}`;
}

export class TokenBucket {
  private readonly buckets = new Map<string, Bucket>();

  take(key: string, now = Date.now()): boolean {
    const { capacity, refillPerSec } = readProbeRateConfig();
    const existing = this.buckets.get(key);
    if (!existing) {
      this.buckets.set(key, { tokens: capacity - 1, updatedAt: now });
      return capacity >= 1;
    }
    const elapsed = Math.max(0, now - existing.updatedAt) / 1000;
    const tokens = Math.min(capacity, existing.tokens + elapsed * refillPerSec);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      return false;
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return true;
  }
}

let singleton: TokenBucket | null = null;

/** Shared with the process so tests can drain the same buckets the HTTP handlers use. */
export function probeRateLimiter(): TokenBucket {
  if (!singleton) singleton = new TokenBucket();
  return singleton;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
