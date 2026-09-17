import { EntitlementException } from "./errors";

/**
 * `PAYMENTS_ENABLED` hard switch (FR-PAY-023 / D-PAY-P11).
 * Default true. Read at process start for Nest module registration.
 */
export function parsePaymentsEnabled(raw: string | undefined | null): boolean {
  if (raw == null) return true;
  const value = raw.trim().toLowerCase();
  if (value === "") return true;
  if (value === "false" || value === "0" || value === "off" || value === "no") return false;
  return true;
}

export function isPaymentsEnabled(): boolean {
  return parsePaymentsEnabled(process.env.PAYMENTS_ENABLED);
}

export function assertPaymentsEnabled(): void {
  if (!isPaymentsEnabled()) {
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Payments are disabled for this deployment",
    );
  }
}

export function assertPaymentsAvailable<T>(payments: T | null | undefined): asserts payments is T {
  if (payments == null) {
    throw new EntitlementException(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Payments are disabled for this deployment",
    );
  }
}
