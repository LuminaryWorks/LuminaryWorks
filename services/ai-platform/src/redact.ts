const KEY_PATTERN = /\bsk-(?:[A-Za-z0-9_-]|\*){4,}/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]{6,}/gi;
const QUERY_KEY_PATTERN = /([?&](?:key|api_key|access_token)=)[^&\s]+/gi;

/** Strip provider secrets from a string before it is logged or returned. */
export function redactText(input: string, secrets: readonly string[] = []): string {
  let out = input;
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed.length < 4) continue;
    out = out.split(trimmed).join("[redacted]");
  }
  return out
    .replace(KEY_PATTERN, "[redacted]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(QUERY_KEY_PATTERN, "$1[redacted]");
}

export function redactValue(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = redactValue(item, secrets);
  return out;
}

/** The only log line provider probes should emit. The message is redacted first. */
export function logProviderFailure(scope: string, error: unknown, secrets: readonly string[] = []): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[ai-platform] ${scope}: ${redactText(message, secrets)}`);
}
