/**
 * Reference rules for partner-operator scopes.
 * Entitlement AuthGuard is intentionally not modified here: product lifecycle
 * and the existing partner redemption scopes live in services/entitlement.
 */

export const PARTNER_ACTIONS = ["orders:read", "ai:usage:read", "catalog:read"];

export const PLATFORM_ADMIN_SCOPES = ["entitlement:admin", "ai:admin"];

export const PUBLIC_CLIENT_ID_PLACEHOLDER = "PUBLIC_CLIENT_ID_PLACEHOLDER";

export const ENTITLEMENT_RESOURCE = "https://entitlement.luminaryworks.dev";

export const AI_RESOURCE = "https://ai.luminaryworks.dev";

const CODE = /^[a-z][a-z0-9-]{0,62}$/;

const ADMIN_SCOPES_FOR_ACTION = {
  "orders:read": ["entitlement:admin"],
  "catalog:read": ["entitlement:admin"],
  "ai:usage:read": ["ai:admin"],
};

export function partnerScope(code, action) {
  if (!PARTNER_ACTIONS.includes(action)) {
    throw Object.assign(new Error(`Unknown partner action: ${action}`), { code: "VALIDATION_ERROR" });
  }
  if (!CODE.test(code)) {
    throw Object.assign(new Error(`Invalid product code: ${code}`), { code: "VALIDATION_ERROR" });
  }
  return `partner:${code}:${action}`;
}

export function scopesForProduct(code) {
  return PARTNER_ACTIONS.map((action) => partnerScope(code, action));
}

/**
 * Allow a platform admin, or a principal that holds partner:<productCode>:<action>
 * for this product only.
 *
 * kind "admin" and kind "service" pass, matching Entitlement AuthGuard.
 * entitlement:admin covers orders and catalog reads. ai:admin covers AI usage reads.
 * Neither admin scope implies the other. partner:redeem / partner:revoke /
 * partner:reconcile do not satisfy these actions.
 */
export function assertPartnerOrAdmin(principal, productCode, action) {
  if (!PARTNER_ACTIONS.includes(action)) {
    throw Object.assign(new Error(`Unknown partner action: ${action}`), { code: "VALIDATION_ERROR" });
  }
  if (!principal || !Array.isArray(principal.scopes)) {
    throw Object.assign(new Error("Missing principal"), { code: "FORBIDDEN" });
  }
  if (principal.kind === "service" || principal.kind === "admin") return;
  const scopes = principal.scopes;
  if (ADMIN_SCOPES_FOR_ACTION[action].some((scope) => scopes.includes(scope))) return;
  const needed = partnerScope(productCode, action);
  if (!scopes.includes(needed)) {
    throw Object.assign(new Error(`Missing scope ${needed}`), { code: "FORBIDDEN" });
  }
  if (principal.partnerCode && principal.partnerCode !== productCode) {
    throw Object.assign(
      new Error(`Partner ${principal.partnerCode} cannot act on ${productCode}`),
      { code: "FORBIDDEN" },
    );
  }
}
