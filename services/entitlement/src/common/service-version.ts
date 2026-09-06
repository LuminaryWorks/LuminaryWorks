/**
 * Version contract for `GET /version`.
 *
 * `apiVersion` is the HTTP surface version and `schemaVersion` the DTO / event
 * payload major version declared in a Control Manifest
 * (`@luminaryworks/control-manifest`). Bump `schemaVersion` only on a breaking
 * payload change — product adapters refuse an unknown version rather than
 * guessing.
 */
export const ENTITLEMENT_SERVICE_NAME = "luminary-entitlement";
export const ENTITLEMENT_SERVICE_VERSION = "0.2.0";
export const ENTITLEMENT_API_VERSION = "v1";
export const ENTITLEMENT_SCHEMA_VERSION = "1";

export interface ServiceVersionPayload {
  service: string;
  version: string;
  apiVersion: string;
  schemaVersion: string;
  gitSha: string;
}

export function buildServiceVersionPayload(
  env: Record<string, string | undefined> = process.env,
): ServiceVersionPayload {
  const gitSha = env.ENTITLEMENT_GIT_SHA?.trim();
  return {
    service: ENTITLEMENT_SERVICE_NAME,
    version: ENTITLEMENT_SERVICE_VERSION,
    apiVersion: ENTITLEMENT_API_VERSION,
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    gitSha: gitSha && gitSha !== "" ? gitSha : "unknown",
  };
}
