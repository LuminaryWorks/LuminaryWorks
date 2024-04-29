export const SUBJECT_KINDS = ["USER", "ORGANIZATION", "DEPLOYMENT"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const PLAN_CODES = ["trial", "pro", "ultra", "enterprise"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const PRODUCT_CODES = ["dataluminary", "blockyedu", "vistaremote", "doerflow"] as const;
export type ProductCode = (typeof PRODUCT_CODES)[number];

export const TRIAL_POLICIES = ["standard_7d", "disabled"] as const;
export type TrialPolicy = (typeof TRIAL_POLICIES)[number];

export const SUBSCRIPTION_STATUSES = ["active", "canceled", "expired", "pending"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const QUOTA_PERIODS = ["lifetime", "calendar_month", "rolling_days", "concurrent"] as const;
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];

export const FEATURE_EFFECTS = ["allow", "deny"] as const;
export type FeatureEffect = (typeof FEATURE_EFFECTS)[number];

export const QUOTA_MERGE = ["max", "sum"] as const;
export type QuotaMerge = (typeof QUOTA_MERGE)[number];

export const PLAN_PRIORITY: Record<PlanCode | "none", number> = {
  none: 0,
  trial: 1,
  pro: 2,
  ultra: 3,
  enterprise: 4,
};

export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export const ENTITLEMENT_ERROR_CODES = [
  "ENTITLEMENT_REQUIRED",
  "ENTITLEMENT_TRIAL_EXPIRED",
  "ENTITLEMENT_FEATURE_REQUIRED",
  "ENTITLEMENT_QUOTA_EXCEEDED",
  "ENTITLEMENT_SEAT_EXHAUSTED",
  "ENTITLEMENT_LICENSE_INVALID",
  "ENTITLEMENT_LICENSE_EXPIRED",
  "ENTITLEMENT_SERVICE_UNAVAILABLE",
  "PRODUCT_TRIAL_DISABLED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
] as const;

export type EntitlementErrorCode = (typeof ENTITLEMENT_ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<EntitlementErrorCode, number> = {
  ENTITLEMENT_REQUIRED: 402,
  ENTITLEMENT_TRIAL_EXPIRED: 402,
  ENTITLEMENT_FEATURE_REQUIRED: 402,
  ENTITLEMENT_QUOTA_EXCEEDED: 402,
  ENTITLEMENT_SEAT_EXHAUSTED: 402,
  ENTITLEMENT_LICENSE_INVALID: 402,
  ENTITLEMENT_LICENSE_EXPIRED: 402,
  ENTITLEMENT_SERVICE_UNAVAILABLE: 503,
  PRODUCT_TRIAL_DISABLED: 402,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
};
