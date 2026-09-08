export type GeoHeaderMap = Record<string, string | string[] | undefined>;

export interface GeoResolveInput {
  directPeerIp: string | null;
  headers: GeoHeaderMap;
  trustedProxies: string[];
  defaultCountry: string | null;
}

export interface GeoContext {
  country: string | null;
  source: "trusted_header" | "default" | "unknown";
  trustedProxy: boolean;
  directPeerIp: string | null;
}

const TRUSTED_COUNTRY_HEADERS = ["cf-ipcountry", "x-geo-country", "cloudfront-viewer-country"];

export function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  let value = ip.trim();
  if (value.startsWith("::ffff:")) value = value.slice("::ffff:".length);
  if (value === "::1") return "127.0.0.1";
  return value || null;
}

export function headerValue(headers: GeoHeaderMap, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}

export function parseTrustedProxies(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    n = (n << 8) + value;
  }
  return n >>> 0;
}

export function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const ipn = ipv4ToInt(ip);
  const basen = ipv4ToInt(base ?? "");
  const bits = Number(bitsRaw);
  if (ipn == null || basen == null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : ~((1 << (32 - bits)) - 1) >>> 0;
  return (ipn & mask) === (basen & mask);
}

export function ipMatchesTrustedProxy(ip: string | null, proxies: string[]): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized || proxies.length === 0) return false;
  return proxies.some((entry) => {
    const spec = entry.trim();
    if (!spec) return false;
    if (spec.includes("/")) {
      return ipv4InCidr(normalized, spec);
    }
    return normalizeIp(spec) === normalized;
  });
}

export function normalizeCountryCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(trimmed)) return null;
  return trimmed;
}

export function resolveGeoContext(input: GeoResolveInput): GeoContext {
  const directPeerIp = normalizeIp(input.directPeerIp);
  const trustedProxy = ipMatchesTrustedProxy(directPeerIp, input.trustedProxies);
  if (trustedProxy) {
    for (const header of TRUSTED_COUNTRY_HEADERS) {
      const country = normalizeCountryCode(headerValue(input.headers, header));
      if (country) {
        return { country, source: "trusted_header", trustedProxy: true, directPeerIp };
      }
    }
  }
  const fallback = normalizeCountryCode(input.defaultCountry);
  if (fallback) {
    return { country: fallback, source: "default", trustedProxy, directPeerIp };
  }
  return { country: null, source: "unknown", trustedProxy, directPeerIp };
}

export function requestHeaders(headers: GeoHeaderMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const scalar = Array.isArray(value) ? value[0] : value;
    if (typeof scalar === "string") out[key.toLowerCase()] = scalar;
  }
  return out;
}

export function directPeerFromRequest(req: {
  socket?: { remoteAddress?: string };
  raw?: { socket?: { remoteAddress?: string } };
}): string | null {
  return normalizeIp(req.socket?.remoteAddress ?? req.raw?.socket?.remoteAddress ?? null);
}
