/**
 * Ensure camelCase entity properties map to snake_case DB columns when migrations use snake_case.
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.join("src", "database", "entities");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".entity.ts"));

const CAMEL_TO_SNAKE = [
  ["limitValue", "limit_value"],
  ["quotaPeriod", "quota_period"],
  ["quotaMerge", "quota_merge"],
  ["lastError", "last_error"],
  ["seatLimit", "seat_limit"],
  ["seatUsed", "seat_used"],
  ["amountCents", "amount_cents"],
  ["paymentProvider", "payment_provider"],
  ["providerRef", "provider_ref"],
  ["offlineGraceDays", "offline_grace_days"],
  ["deadLetteredAt", "dead_lettered_at"],
  ["maxAttempts", "max_attempts"],
  ["nextAttemptAt", "next_attempt_at"],
  ["scheduledFor", "scheduled_for"],
  ["dedupeKey", "dedupe_key"],
  ["eventType", "event_type"],
  ["emailEnabled", "email_enabled"],
  ["inAppEnabled", "in_app_enabled"],
  ["pushEnabled", "push_enabled"],
  ["emailAddress", "email_address"],
  ["pushTokens", "push_tokens"],
  ["clientSecretHash", "client_secret_hash"],
  ["webhookSecret", "webhook_secret"],
  ["webhookUrl", "webhook_url"],
  ["clientId", "client_id"],
  ["benefitId", "benefit_id"],
  ["logtoSub", "logto_sub"],
  ["productCode", "product_code"],
  ["planCode", "plan_code"],
  ["grantId", "grant_id"],
  ["subscriptionId", "subscription_id"],
  ["startsAt", "starts_at"],
  ["endsAt", "ends_at"],
  ["revokedAt", "revoked_at"],
  ["partnerId", "partner_id"],
  ["redemptionId", "redemption_id"],
  ["sourceRef", "source_ref"],
  ["organizationId", "organization_id"],
  ["subjectKind", "subject_kind"],
  ["subjectId", "subject_id"],
  ["featureCode", "feature_code"],
  ["periodKey", "period_key"],
  ["bundleSku", "bundle_sku"],
  ["bundleId", "bundle_id"],
  ["productId", "product_id"],
  ["planId", "plan_id"],
  ["featureId", "feature_id"],
  ["licenseId", "license_id"],
  ["deploymentId", "deployment_id"],
  ["activatedAt", "activated_at"],
  ["expiresAt", "expires_at"],
  ["canceledAt", "canceled_at"],
  ["idempotencyKey", "idempotency_key"],
  ["resourceType", "resource_type"],
  ["resourceId", "resource_id"],
  ["requestId", "request_id"],
  ["eventId", "event_id"],
  ["durationDays", "duration_days"],
];

let fixedFiles = 0;
for (const file of files) {
  const p = path.join(dir, file);
  let src = fs.readFileSync(p, "utf8");
  const original = src;
  for (const [camel, snake] of CAMEL_TO_SNAKE) {
    // Match @Column({ ... })\n  camel!: without an existing name: "snake"
    const re = new RegExp(
      `(@Column\\(\\{)([^}]*?)(\\}\\)\\s*\\n\\s*${camel}!)`,
      "g",
    );
    src = src.replace(re, (full, a, mid, c) => {
      if (mid.includes(`name: "${snake}"`) || mid.includes(`name: '${snake}'`)) {
        return full;
      }
      if (/\bname\s*:/.test(mid)) return full;
      const trimmed = mid.trim();
      const insert = trimmed.length
        ? ` name: "${snake}", ${trimmed} `
        : ` name: "${snake}" `;
      return `${a}${insert}${c}`;
    });
  }
  if (src !== original) {
    fs.writeFileSync(p, src);
    fixedFiles += 1;
    console.log("fixed", file);
  }
}
console.log("done files=", fixedFiles);
