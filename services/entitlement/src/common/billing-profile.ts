import { EntitlementException } from "./errors";

export const PAYER_TYPES = ["individual", "business"] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

/** Shape-only tax id (VAT / USCC). Not a live tax-authority check. */
export const TAX_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9 .-]{1,62}$/;

export function isPayerType(value: unknown): value is PayerType {
  return value === "individual" || value === "business";
}

export function assertTaxIdShape(taxId: string | null | undefined): void {
  if (taxId == null) return;
  const trimmed = taxId.trim();
  if (trimmed === "") return;
  if (trimmed.length < 2 || trimmed.length > 64 || !TAX_ID_SHAPE.test(trimmed)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "taxId failed shape validation (2–64 letters, digits, space, dot, or hyphen)",
    );
  }
}

export function assertBillingProfileComplete(input: {
  payerType: string;
  companyName?: string | null;
  country?: string | null;
  taxId?: string | null;
}): void {
  const payerType = input.payerType || "individual";
  assertTaxIdShape(input.taxId);
  if (payerType !== "business") return;
  const companyName = input.companyName?.trim() ?? "";
  const country = input.country?.trim() ?? "";
  if (!companyName || country.length !== 2) {
    throw new EntitlementException(
      "PAYMENT_BILLING_PROFILE_INCOMPLETE",
      "Business billing profiles require companyName and country",
    );
  }
}
