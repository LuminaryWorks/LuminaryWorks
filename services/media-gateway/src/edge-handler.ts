import { canonicalObjectKey } from "./paths";
import { verifySignedRequest } from "./token";

const ipInflight = new Map<string, number>();
const sessionInflight = new Map<string, number>();

export function resetEdgeLimits(): void {
  ipInflight.clear();
  sessionInflight.clear();
}

export type EdgeOrigin = {
  get(objectKey: string): Promise<Uint8Array | null>;
};

const IP_MAX = 8;
const SESSION_MAX = 6;

export async function handleEdgeRequest(
  request: Request,
  input: {
    secret: string;
    clientIp: string;
    origin: EdgeOrigin;
    maxTtlSec: number;
    nowMs?: number;
  },
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return edgeText(405, "METHOD_NOT_ALLOWED");
  }
  const url = new URL(request.url);
  const canonical = canonicalObjectKey(url.pathname);
  if (!canonical) return edgeText(404, "NOT_FOUND");
  const exp = Number(url.searchParams.get("exp"));
  const sid = url.searchParams.get("sid") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const ok = await verifySignedRequest({
    secret: input.secret,
    exp,
    sessionId: sid,
    path: url.pathname,
    sig,
    nowMs: input.nowMs,
    maxTtlSec: input.maxTtlSec,
  });
  if (!ok) return edgeText(401, "TOKEN_INVALID");

  const ipOk = takeSlot(ipInflight, input.clientIp, IP_MAX);
  const sessionOk = ipOk && takeSlot(sessionInflight, sid, SESSION_MAX);
  if (!ipOk || !sessionOk) {
    if (ipOk) release(ipInflight, input.clientIp);
    if (sessionOk) release(sessionInflight, sid);
    return edgeText(429, "RATE_LIMITED");
  }
  try {
    const bytes = await input.origin.get(canonical);
    if (!bytes) return edgeText(404, "NOT_FOUND");
    const headers = {
      ...corsHeaders(),
      "content-type": "video/mp2t",
      "cache-control": "public, max-age=86400",
      "x-luminary-object": canonical,
    };
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, { status: 200, headers });
  } finally {
    release(ipInflight, input.clientIp);
    release(sessionInflight, sid);
  }
}

function takeSlot(map: Map<string, number>, key: string, max: number): boolean {
  const current = map.get(key) ?? 0;
  if (current >= max) return false;
  map.set(key, current + 1);
  return true;
}

function release(map: Map<string, number>, key: string): void {
  const current = map.get(key) ?? 0;
  if (current <= 1) map.delete(key);
  else map.set(key, current - 1);
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
  };
}

function edgeText(status: number, code: string): Response {
  return new Response(code, { status, headers: { ...corsHeaders(), "cache-control": "no-store" } });
}
