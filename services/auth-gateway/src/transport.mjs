const DEFAULT_DISCOVERY_PATHS = Object.freeze([
  "/oidc",
  "/oidc/.well-known/openid-configuration",
  "/.well-known/openid-configuration",
]);

function trimTrailingSlash(value) {
  return String(value).replace(/\/$/, "");
}

function normalizePath(value) {
  const path = String(value).trim();
  if (!path) return "";
  return path.startsWith("/") ? path : `/${path}`;
}

export function parsePathList(value, fallback = DEFAULT_DISCOVERY_PATHS) {
  if (!value) return [...fallback];
  return String(value)
    .split(",")
    .map(normalizePath)
    .filter(Boolean);
}

export function createTransportRewriter({
  upstreamIssuer,
  publicBase,
  preserveDiscoveryFields = ["issuer"],
  rewriteOrigins,
}) {
  const normalizedUpstreamIssuer = trimTrailingSlash(upstreamIssuer);
  const normalizedPublicBase = trimTrailingSlash(publicBase);
  const upstreamOrigin = new URL(normalizedUpstreamIssuer).origin;
  const preservedFields = new Set(preserveDiscoveryFields);
  const sourceOrigins = [
    ...new Set((rewriteOrigins || [upstreamOrigin]).map(trimTrailingSlash)),
  ].sort((a, b) => b.length - a.length);

  function rewriteUrl(value) {
    for (const origin of sourceOrigins) {
      if (value === origin || value.startsWith(`${origin}/`)) {
        return `${normalizedPublicBase}${value.slice(origin.length)}`;
      }
    }
    return value;
  }

  return {
    upstreamIssuer: normalizedUpstreamIssuer,
    upstreamOrigin,
    publicBase: normalizedPublicBase,
    publicIssuer: `${normalizedPublicBase}${new URL(normalizedUpstreamIssuer).pathname}`.replace(
      /\/$/,
      "",
    ),

    rewriteDiscovery(body) {
      try {
        const data = JSON.parse(body);
        if (!data || typeof data !== "object" || Array.isArray(data)) return body;
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "string" && !preservedFields.has(key)) {
            data[key] = rewriteUrl(value);
          }
        }
        return JSON.stringify(data);
      } catch {
        return body;
      }
    },

    rewriteLocation(location) {
      return location ? rewriteUrl(location) : location;
    },

    rewriteSetCookie(cookie) {
      return cookie
        .split(";")
        .map((part) => part.trim())
        .filter((part) => !/^domain=/i.test(part))
        .join("; ");
    },
  };
}

export function isDiscoveryPath(pathname, discoveryPaths = DEFAULT_DISCOVERY_PATHS) {
  const normalized = pathname.replace(/\/$/, "") || "/";
  return discoveryPaths.some((path) => normalized === (path.replace(/\/$/, "") || "/"));
}

export { DEFAULT_DISCOVERY_PATHS };
