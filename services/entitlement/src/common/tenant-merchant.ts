export function normalizeMerchantId(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function usesReservedPlatformMerchant(
  merchantId: string | null | undefined,
  reserved: readonly string[],
): boolean {
  const normalized = normalizeMerchantId(merchantId);
  if (!normalized) return false;
  return reserved.some((item) => normalizeMerchantId(item) === normalized);
}
