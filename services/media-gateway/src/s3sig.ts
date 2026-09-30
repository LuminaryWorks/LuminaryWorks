const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function owned(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const raw = key instanceof Uint8Array ? owned(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(body: Uint8Array | string): Promise<string> {
  const data = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(owned(body));
  return hex(await crypto.subtle.digest("SHA-256", data));
}

async function signingKey(secret: string, date: string, region: string): Promise<ArrayBuffer> {
  const dateKey = await hmac(new TextEncoder().encode(`AWS4${secret}`), date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

export async function signedS3Headers(input: {
  method: "GET" | "PUT";
  endpoint: string;
  region: string;
  bucket: string;
  objectKey: string;
  accessKeyId: string;
  secretAccessKey: string;
  body?: Uint8Array;
  contentType?: string;
  now?: Date;
  unsignedPayload?: boolean;
}): Promise<{ url: string; headers: Record<string, string> }> {
  const host = new URL(input.endpoint).host;
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = input.unsignedPayload
    ? "UNSIGNED-PAYLOAD"
    : input.body
      ? await sha256Hex(input.body)
      : EMPTY_SHA256;
  const canonicalUri = `/${encodeObjectKey(input.bucket)}/${encodeObjectKey(input.objectKey)}`;
  const headerLines = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ];
  if (input.contentType) headerLines.push(`content-type:${input.contentType}`);
  headerLines.sort();
  const canonicalHeaders = `${headerLines.join("\n")}\n`;
  const signedHeaders = headerLines.map((line) => line.slice(0, line.indexOf(":"))).join(";");
  const canonicalRequest = [
    input.method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hex(await hmac(await signingKey(input.secretAccessKey, date, input.region), stringToSign));
  const headers: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (input.contentType) headers["content-type"] = input.contentType;
  return {
    url: `${input.endpoint.replace(/\/$/, "")}${canonicalUri}`,
    headers,
  };
}
