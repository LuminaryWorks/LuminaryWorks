/** Integer micro-units. 1 credit = 1_000_000 micro. Never use floats. */

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

export function microToNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max || value < -max) {
    throw new Error("micro amount exceeds Number.MAX_SAFE_INTEGER");
  }
  return Number(value);
}

export function assertPositiveMicro(value: bigint, label: string): void {
  if (value <= 0n) throw new Error(`${label} must be positive`);
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const row = error as { code?: string; driverError?: { code?: string } };
  return row.code === "23505" || row.driverError?.code === "23505";
}
