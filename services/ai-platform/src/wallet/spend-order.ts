/**
 * Deduct order from spec/ai-wallet-and-billing.md §3:
 * 1. restricted and soonest expiry
 * 2. unrestricted and soonest expiry
 * 3. restricted without expiry (not listed in §3; used before evergreen topup)
 * 4. other non-expiring grants
 * 5. non-expiring topup
 */

export interface SpendGrant {
  grantId: string;
  kind: string;
  remainingMicro: bigint;
  expiresAt: Date | null;
  createdAt: Date;
  restrictProductCodes: string[] | null;
  restrictCapabilities: string[] | null;
  /** Set once revokeBySource has run. A revoked grant is never spendable. */
  revokedAt?: Date | null;
}

export interface SpendContext {
  productCode: string;
  capability: string;
  now: Date;
}

export function isRestricted(grant: SpendGrant): boolean {
  return (grant.restrictProductCodes?.length ?? 0) > 0 || (grant.restrictCapabilities?.length ?? 0) > 0;
}

export function capabilityMatches(rules: string[] | null | undefined, capability: string): boolean {
  if (!rules || rules.length === 0) return true;
  return rules.some((rule) => {
    if (rule.endsWith(".*")) return capability.startsWith(rule.slice(0, -1));
    if (rule.endsWith("*")) return capability.startsWith(rule.slice(0, -1));
    return rule === capability;
  });
}

export function grantEligible(grant: SpendGrant, ctx: SpendContext): boolean {
  if (grant.revokedAt) return false;
  if (grant.remainingMicro <= 0n) return false;
  if (grant.expiresAt && grant.expiresAt.getTime() <= ctx.now.getTime()) return false;
  const products = grant.restrictProductCodes ?? [];
  if (products.length > 0 && !products.includes(ctx.productCode)) return false;
  if (!capabilityMatches(grant.restrictCapabilities, ctx.capability)) return false;
  return true;
}

/** Lower bucket is spent first. */
export function spendBucket(grant: SpendGrant): number {
  const restricted = isRestricted(grant);
  const expiring = grant.expiresAt != null;
  if (restricted && expiring) return 0;
  if (!restricted && expiring) return 1;
  if (restricted && !expiring) return 2;
  if (!expiring && grant.kind === "topup") return 4;
  return 3;
}

export function compareSpend(a: SpendGrant, b: SpendGrant): number {
  const bucket = spendBucket(a) - spendBucket(b);
  if (bucket !== 0) return bucket;
  if (a.expiresAt && b.expiresAt) {
    const expiry = a.expiresAt.getTime() - b.expiresAt.getTime();
    if (expiry !== 0) return expiry;
  }
  const created = a.createdAt.getTime() - b.createdAt.getTime();
  if (created !== 0) return created;
  return a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0;
}

export function grantsForSpend(grants: SpendGrant[], ctx: SpendContext): SpendGrant[] {
  return grants.filter((grant) => grantEligible(grant, ctx)).sort(compareSpend);
}
