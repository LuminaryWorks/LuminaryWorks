/**
 * Health / ready / version contract for the Auth Gateway.
 *
 *   GET /health   liveness only — the process is up. Never touches the upstream.
 *   GET /ready    non-2xx when a critical dependency is unusable.
 *   GET /version  service, API and schema versions plus the build's git SHA.
 *
 * The functions here are pure so the contract can be unit-tested without a
 * listening socket or a live IdP. See spec/composable-deployment.md §health.
 */

export const HEALTH_PATHS = Object.freeze(["/health", "/healthz"]);
export const READY_PATHS = Object.freeze(["/ready", "/readyz"]);
export const VERSION_PATHS = Object.freeze(["/version"]);

/** HTTP surface + payload schema versions declared in the Control Manifest. */
export const AUTH_GATEWAY_API_VERSION = "v1";
export const AUTH_GATEWAY_SCHEMA_VERSION = "1";

export function buildHealthPayload({ publicIssuer, upstreamIssuer }) {
  return {
    status: "ok",
    service: "luminary-auth-gateway",
    publicIssuer,
    upstreamIssuer,
  };
}

export function buildVersionPayload({ version, gitSha, publicIssuer, upstreamIssuer }) {
  return {
    service: "luminary-auth-gateway",
    version: version ?? "0.0.0",
    apiVersion: AUTH_GATEWAY_API_VERSION,
    schemaVersion: AUTH_GATEWAY_SCHEMA_VERSION,
    gitSha: gitSha && gitSha.trim() !== "" ? gitSha.trim() : "unknown",
    publicIssuer,
    upstreamIssuer,
  };
}

/**
 * Turns dependency check results into a readiness payload.
 *
 * A gateway that cannot reach its IdP must report NOT ready: failing open would
 * let products treat an unreachable AuthN provider as an anonymous session.
 *
 * @param {{ name: string, status: "up" | "down" | "skipped", detail?: string }[]} checks
 */
export function evaluateReadiness(checks) {
  const down = checks.filter((check) => check.status === "down");
  const ready = down.length === 0;
  return {
    statusCode: ready ? 200 : 503,
    payload: {
      status: ready ? "ready" : "not_ready",
      service: "luminary-auth-gateway",
      checks,
      ...(ready ? {} : { failed: down.map((check) => check.name) }),
    },
  };
}

/**
 * Fetches the upstream discovery document. Returns a readiness check entry;
 * never throws.
 */
export async function checkUpstreamDiscovery({ upstreamIssuer, timeoutMs = 2000, fetchImpl }) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const url = `${String(upstreamIssuer).replace(/\/$/, "")}/.well-known/openid-configuration`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { name: "upstream_issuer", status: "down", detail: `HTTP ${response.status}` };
    }
    return { name: "upstream_issuer", status: "up" };
  } catch (err) {
    return {
      name: "upstream_issuer",
      status: "down",
      detail: err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(err?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}
