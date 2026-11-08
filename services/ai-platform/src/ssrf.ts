import { lookup } from "node:dns/promises";
import dns from "node:dns";
import { BlockList, isIP } from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
import { resolveChatCompletionsUrl, resolveModelsUrl } from "@luminaryworks/ai-client";
import { AiPlatformException } from "./common/errors";
import { allowPrivateBaseUrls } from "./policy";

export { allowPrivateBaseUrls };

/**
 * SSRF guard for customer-supplied provider base URLs.
 *
 * Rejects non-http(s), embedded credentials, loopback, link-local, RFC1918,
 * multicast/reserved, and well-known metadata addresses. Hostnames are resolved
 * before use; if any answer is blocked, the URL is rejected. The chosen address
 * is pinned for the outbound fetch (custom dns.lookup + redirect blocking) so a
 * later DNS answer cannot retarget the connection.
 *
 * AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS=true skips the private-address and metadata
 * hostname checks for lab and tests. It still requires http(s) and rejects
 * embedded credentials. Leave it unset in production.
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

const BLOCKED_NETS = new BlockList();
BLOCKED_NETS.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED_NETS.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED_NETS.addSubnet("127.0.0.0", 8, "ipv4");
BLOCKED_NETS.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED_NETS.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED_NETS.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED_NETS.addSubnet("224.0.0.0", 4, "ipv4");
BLOCKED_NETS.addSubnet("240.0.0.0", 4, "ipv4");
BLOCKED_NETS.addAddress("100.100.100.200", "ipv4");
BLOCKED_NETS.addAddress("::", "ipv6");
BLOCKED_NETS.addAddress("::1", "ipv6");
BLOCKED_NETS.addSubnet("fc00::", 7, "ipv6");
BLOCKED_NETS.addSubnet("fe80::", 10, "ipv6");
BLOCKED_NETS.addSubnet("ff00::", 8, "ipv6");
BLOCKED_NETS.addAddress("fd00:ec2::254", "ipv6");

export interface PinnedTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
}

interface PinContext {
  pins: Map<string, { address: string; family: 4 | 6 }>;
}

const pinStore = new AsyncLocalStorage<PinContext>();
let guardsInstalled = false;

export function installOutboundGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;
  const originalLookup = dns.lookup.bind(dns) as typeof dns.lookup;
  dns.lookup = ((hostname: string, options?: unknown, callback?: unknown) => {
    let opts: { all?: boolean } = {};
    let cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;
    if (typeof options === "function") {
      cb = options as typeof cb;
    } else if (typeof callback === "function") {
      cb = callback as typeof cb;
      if (options && typeof options === "object") opts = options as { all?: boolean };
    } else {
      throw new Error("dns.lookup callback required");
    }
    const ctx = pinStore.getStore();
    if (!ctx) return originalLookup(hostname, options as never, callback as never);
    const pin = ctx.pins.get(bareHost(hostname));
    if (!pin) {
      const err = Object.assign(new Error("unpinned host"), { code: "ENOTFOUND" });
      if (opts.all) cb(err, []);
      else cb(err, "", 4);
      return;
    }
    if (opts.all) cb(null, [{ address: pin.address, family: pin.family }]);
    else cb(null, pin.address, pin.family);
    return;
  }) as typeof dns.lookup;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!pinStore.getStore()) return originalFetch(input, init);
    const response = await originalFetch(input, { ...(init ?? {}), redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("upstream redirect blocked");
    }
    return response;
  }) as typeof fetch;
}

export async function assertSafeBaseUrl(raw: string | null | undefined): Promise<void> {
  if (!raw?.trim()) return;
  await pinHttpUrl(raw);
}

export async function pinHttpUrl(raw: string): Promise<PinnedTarget> {
  installOutboundGuards();
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw blocked("baseUrl is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw blocked("baseUrl must be http or https");
  }
  if (url.username || url.password) {
    throw blocked("baseUrl must not include credentials");
  }
  const hostname = bareHost(url.hostname);
  if (!hostname) throw blocked("baseUrl is not a valid URL");
  const allowPrivate = allowPrivateBaseUrls();
  if (!allowPrivate && isBlockedHostname(hostname)) throw blocked("baseUrl is not allowed");

  let records: Array<{ address: string; family: 4 | 6 }>;
  try {
    records = await resolveHosts(hostname);
  } catch (error) {
    if (error instanceof AiPlatformException) throw error;
    throw blocked("baseUrl host could not be resolved");
  }
  if (records.length === 0) throw blocked("baseUrl host could not be resolved");
  if (!allowPrivate && records.some((record) => isBlockedAddress(record.address))) {
    throw blocked("baseUrl is not allowed");
  }
  const chosen = records[0];
  if (!chosen) throw blocked("baseUrl host could not be resolved");
  return { hostname, address: chosen.address, family: chosen.family };
}

export async function pinProviderEndpoint(
  providerType: string,
  baseUrl: string | null | undefined,
  kind: "chat" | "models",
): Promise<PinnedTarget | null> {
  const url =
    kind === "models"
      ? (resolveModelsUrl(providerType, baseUrl) ?? resolveChatCompletionsUrl(providerType, baseUrl))
      : resolveChatCompletionsUrl(providerType, baseUrl);
  if (!url) return null;
  return pinHttpUrl(url);
}

export function runWithPin<T>(pin: PinnedTarget | null, fn: () => T): T {
  if (!pin) return fn();
  installOutboundGuards();
  const pins = new Map<string, { address: string; family: 4 | 6 }>();
  pins.set(pin.hostname, { address: pin.address, family: pin.family });
  return pinStore.run({ pins }, fn);
}

export async function* iterateWithPin<T>(
  pin: PinnedTarget | null,
  source: AsyncGenerator<T>,
): AsyncGenerator<T> {
  if (!pin) {
    yield* source;
    return;
  }
  installOutboundGuards();
  const context: PinContext = {
    pins: new Map([[pin.hostname, { address: pin.address, family: pin.family }]]),
  };
  try {
    while (true) {
      const step = await pinStore.run(context, () => source.next());
      if (step.done) return;
      yield step.value;
    }
  } finally {
    await pinStore.run(context, () => source.return(undefined)).catch(() => undefined);
  }
}

function blocked(message: string): AiPlatformException {
  return new AiPlatformException("VALIDATION_ERROR", 400, message);
}

function bareHost(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1);
  return trimmed;
}

function isBlockedHostname(hostname: string): boolean {
  const host = bareHost(hostname);
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".google.internal")) return true;
  return false;
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED_NETS.check(address, "ipv4");
  if (family === 6) return BLOCKED_NETS.check(address, "ipv6");
  return true;
}

async function resolveHosts(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const ipFamily = isIP(hostname);
  if (ipFamily === 4 || ipFamily === 6) {
    return [{ address: hostname, family: ipFamily }];
  }
  const records = await withTimeout(lookup(hostname, { all: true, verbatim: true }), 2000);
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dns timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
