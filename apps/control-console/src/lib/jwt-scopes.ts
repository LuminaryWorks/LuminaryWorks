export function readJwtScopes(token: string | null | undefined): string[] {
  if (!token) return [];
  const payload = token.split(".")[1];
  if (!payload) return [];
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const json = JSON.parse(atob(padded)) as {
      scope?: unknown;
      scopes?: unknown;
    };
    if (typeof json.scope === "string")
      return json.scope.split(/\s+/).filter(Boolean);
    if (Array.isArray(json.scopes)) return json.scopes.map(String);
    return [];
  } catch {
    return [];
  }
}

export function isPlatformAdmin(scopes: string[]): boolean {
  return scopes.includes("entitlement:admin");
}
