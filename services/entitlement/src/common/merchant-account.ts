import { EntitlementException } from "./errors";

/**
 * Reserved Connect / per-product merchant account.
 * Null (or blank) means the LuminaryWorks merchant-of-record account.
 * Adapters must not call a provider Connect API with this value yet.
 */
export function readMerchantAccountId(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) {
    throw new EntitlementException("VALIDATION_ERROR", "merchantAccountId exceeds 128 characters");
  }
  return trimmed;
}
