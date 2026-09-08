import type { MeteringMode } from "./constants";
import { EntitlementException } from "./errors";

export function parseNonNegativeInt(value: number | string, field = "amount"): bigint {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        `${field} must be a nonnegative safe integer`,
      );
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new EntitlementException("VALIDATION_ERROR", `${field} must be a nonnegative integer`);
  }
  const parsed = BigInt(trimmed);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new EntitlementException("VALIDATION_ERROR", `${field} exceeds the safe integer range`);
  }
  return parsed;
}

export function bigintToNumber(value: bigint): number {
  if (value < 0n) {
    throw new EntitlementException("VALIDATION_ERROR", "quota total cannot be negative");
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "quota total exceeds the safe integer range",
    );
  }
  return Number(value);
}

export function remainingOf(limit: number | null, used: number): number | null {
  if (limit == null) return null;
  return Math.max(0, limit - used);
}

export function applyGaugeDelta(input: {
  currentUsed: bigint;
  previousAmount: bigint;
  nextAmount: bigint;
  limit: bigint | null;
}): { used: bigint; delta: bigint; unchanged: boolean } {
  if (input.nextAmount < 0n || input.previousAmount < 0n || input.currentUsed < 0n) {
    throw new EntitlementException("VALIDATION_ERROR", "quota amounts cannot be negative");
  }
  const delta = input.nextAmount - input.previousAmount;
  if (delta === 0n) {
    return { used: input.currentUsed, delta: 0n, unchanged: true };
  }
  const used = input.currentUsed + delta;
  if (used < 0n) {
    throw new EntitlementException("VALIDATION_ERROR", "quota total cannot be negative");
  }
  if (delta > 0n && input.limit != null && used > input.limit) {
    throw new EntitlementException("ENTITLEMENT_QUOTA_EXCEEDED", "Quota exceeded", {
      details: {
        remaining: bigintToNumber(
          input.limit > input.currentUsed ? input.limit - input.currentUsed : 0n,
        ),
        need: bigintToNumber(delta),
        used: bigintToNumber(input.currentUsed),
        limit: bigintToNumber(input.limit),
      },
    });
  }
  return { used, delta, unchanged: false };
}

export function assertMeteringMode(
  actual: MeteringMode | null | undefined,
  expected: MeteringMode,
  featureCode: string,
): void {
  const mode = actual ?? "counter";
  if (mode === expected) return;
  if (expected === "counter") {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      `Feature ${featureCode} uses gauge metering; allocate or release a resource instead of consume`,
      { featureCode, details: { meteringMode: mode } },
    );
  }
  throw new EntitlementException(
    "VALIDATION_ERROR",
    `Feature ${featureCode} uses counter metering; consume instead of allocate/release`,
    { featureCode, details: { meteringMode: mode } },
  );
}
