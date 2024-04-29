import type { AuthPrincipal } from "./auth.types";
import { EntitlementException } from "../common/errors";

/**
 * Bind commercial context to verified AuthN claims.
 * - subjectId: never from request body (callers use resolveSubject helpers).
 * - organizationId: user tokens may only use JWT org; service/admin may pass explicit org.
 * - deploymentId: user tokens cannot inject arbitrary deployments.
 */
export function resolveTrustedOrganizationId(
  principal: AuthPrincipal,
  requested?: string | null,
): string | null {
  const fromToken = principal.organizationId?.trim() || null;
  const fromRequest = requested?.trim() || null;

  if (principal.kind === "user") {
    if (fromRequest && fromToken && fromRequest !== fromToken) {
      throw new EntitlementException(
        "FORBIDDEN",
        "organizationId must match the authenticated token org claim",
      );
    }
    // Users cannot escalate into an arbitrary org via query/body.
    return fromToken ?? null;
  }

  // service / admin / partner (partner rarely needs org): allow explicit context
  return fromRequest ?? fromToken;
}

export function resolveTrustedDeploymentId(
  principal: AuthPrincipal,
  requested?: string | null,
): string | undefined {
  const fromRequest = requested?.trim() || undefined;
  if (!fromRequest) return undefined;

  if (principal.kind === "user") {
    throw new EntitlementException(
      "FORBIDDEN",
      "deploymentId requires service or admin credentials",
    );
  }

  if (principal.kind === "service" || principal.kind === "admin") {
    return fromRequest;
  }

  throw new EntitlementException("FORBIDDEN", "deploymentId is not allowed for this principal");
}
