export type IdentityProfile = {
  sub: string;
  email: string;
  name: string;
};

function decodePayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) return {};
  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const json = JSON.parse(atob(padded)) as unknown;
    return json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function claim(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Display claims only. The IdP already verified the token. */
export function readIdentityProfile(
  accessToken: string,
  idToken?: string,
): IdentityProfile {
  const access = decodePayload(accessToken);
  const id = idToken ? decodePayload(idToken) : {};
  return {
    sub: claim(access, "sub") || claim(id, "sub"),
    email: claim(id, "email") || claim(access, "email"),
    name:
      claim(id, "name") ||
      claim(access, "name") ||
      claim(id, "preferred_username") ||
      claim(access, "preferred_username") ||
      claim(id, "username") ||
      claim(access, "username"),
  };
}
