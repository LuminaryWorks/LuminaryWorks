const SESSION_ID = /^[a-f0-9]{32}$/;

export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const byte of view) bin += String.fromCharCode(byte);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(
  secret: string,
  exp: number,
  sessionId: string,
  path: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${exp}.${sessionId}.${path}`),
  );
  return bytesToBase64Url(mac);
}

export async function signedUrl(
  base: string,
  path: string,
  secret: string,
  exp: number,
  sessionId: string,
): Promise<string> {
  const sig = await signToken(secret, exp, sessionId, path);
  const url = new URL(path, `${base}/`);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sid", sessionId);
  url.searchParams.set("sig", sig);
  return url.toString();
}

export async function verifySignedRequest(input: {
  secret: string;
  exp: number;
  sessionId: string;
  path: string;
  sig: string;
  nowMs?: number;
  maxTtlSec: number;
}): Promise<boolean> {
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (!SESSION_ID.test(input.sessionId)) return false;
  if (!Number.isSafeInteger(input.exp)) return false;
  if (input.exp < nowSec) return false;
  if (input.exp > nowSec + input.maxTtlSec) return false;
  const expected = await signToken(input.secret, input.exp, input.sessionId, input.path);
  return safeEqualString(expected, input.sig);
}

export function safeEqualSecret(presented: string, expected: string): boolean {
  return safeEqualString(presented, expected);
}
