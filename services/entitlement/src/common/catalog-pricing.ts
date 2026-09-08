import type { PlanCode } from "./constants";
import { EntitlementException } from "./errors";

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const BILLING_MARKETS = ["CN", "GLOBAL"] as const;
export type BillingMarket = (typeof BILLING_MARKETS)[number];

export const OFFERING_PLAN_CODES = ["pro", "ultra"] as const;
export type OfferingPlanCode = (typeof OFFERING_PLAN_CODES)[number];

export const CATALOG_REVISION_STATUSES = ["draft", "published", "superseded"] as const;
export type CatalogRevisionStatus = (typeof CATALOG_REVISION_STATUSES)[number];

export const MONTH_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const YEAR_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export const CLIENT_PRICE_FIELDS = [
  "amountCents",
  "amountMinor",
  "currency",
  "planCode",
  "endsAt",
] as const;

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === "month" || value === "year";
}

export function isBillingMarket(value: unknown): value is BillingMarket {
  return value === "CN" || value === "GLOBAL";
}

export function isOfferingPlanCode(value: unknown): value is OfferingPlanCode {
  return value === "pro" || value === "ultra";
}

export function intervalDurationMs(interval: BillingInterval): number {
  return interval === "year" ? YEAR_DURATION_MS : MONTH_DURATION_MS;
}

export function addBillingInterval(from: Date, interval: BillingInterval): Date {
  return new Date(from.getTime() + intervalDurationMs(interval));
}

/** New purchase: now → now+interval. Renewal: max(now, currentEndsAt)+interval. */
export function paidSubscriptionEndsAt(
  now: Date,
  interval: BillingInterval,
  currentEndsAt?: Date | null,
): Date {
  const base = currentEndsAt && currentEndsAt.getTime() > now.getTime() ? currentEndsAt : now;
  return addBillingInterval(base, interval);
}

export function rejectClientAuthoritativePricing(body: Record<string, unknown> | undefined): void {
  if (!body) return;
  const present = CLIENT_PRICE_FIELDS.filter((field) => Object.hasOwn(body, field));
  if (present.length === 0) return;
  throw new EntitlementException(
    "PAYMENT_PRICE_MISMATCH",
    "Price, currency, plan, and term are server-authoritative; do not send them on create order",
    { details: { fields: present } },
  );
}

export type PlanFeatureSnapshot = {
  featureCode: string;
  kind: "bool" | "quota";
  effect: "allow" | "deny";
  limitValue: number | null;
};

export function ultraSupersetViolations(
  productCode: string,
  pro: PlanFeatureSnapshot[],
  ultra: PlanFeatureSnapshot[],
): string[] {
  const violations: string[] = [];
  const ultraByCode = new Map(ultra.map((row) => [row.featureCode, row]));

  for (const feature of pro) {
    if (feature.effect === "deny") continue;
    const match = ultraByCode.get(feature.featureCode);
    if (!match) {
      violations.push(`${productCode}: Ultra is missing Pro feature ${feature.featureCode}`);
      continue;
    }
    if (match.effect === "deny") {
      violations.push(`${productCode}: Ultra denies Pro-allowed feature ${feature.featureCode}`);
      continue;
    }
    if (feature.kind === "quota" && feature.limitValue != null) {
      if (match.limitValue == null) continue;
      if (match.limitValue < feature.limitValue) {
        violations.push(
          `${productCode}: Ultra quota ${feature.featureCode} (${match.limitValue}) ` +
            `is below Pro (${feature.limitValue})`,
        );
      }
    }
  }
  return violations;
}

export function assertUltraSupersetOfPro(
  products: Array<{
    productCode: string;
    pro: PlanFeatureSnapshot[];
    ultra: PlanFeatureSnapshot[];
  }>,
): void {
  const violations = products.flatMap((product) =>
    ultraSupersetViolations(product.productCode, product.pro, product.ultra),
  );
  if (violations.length > 0) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "Ultra must be a feature/quota superset of Pro",
      { details: { violations } },
    );
  }
}

export function assertSellableOfferingPlan(planCode: PlanCode | string | null | undefined): void {
  if (planCode === "trial") {
    throw new EntitlementException("PAYMENT_OFFERING_INVALID", "Trial is not a sellable offering");
  }
  if (planCode && !isOfferingPlanCode(planCode)) {
    throw new EntitlementException(
      "PAYMENT_OFFERING_INVALID",
      `Plan ${planCode} is not a ToC checkout offering`,
    );
  }
}
