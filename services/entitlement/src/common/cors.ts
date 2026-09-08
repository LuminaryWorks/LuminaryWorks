/**
 * Browser CORS for the control console (and other allowlisted SPA origins).
 * Production default is closed: an empty allowlist disables CORS entirely.
 */

export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Fastify `@fastify/cors` `origin` option.
 * Empty allowlist → `false` (no Access-Control-Allow-Origin).
 */
export function corsOriginOption(origins: string[]): string[] | false {
  if (origins.length === 0) return false;
  return origins;
}
