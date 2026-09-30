import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { signedS3Headers } from "./s3sig";

type Authorize = {
  bucket: string;
  bucketId: string;
  endpoint: string;
  region: string;
  keyId: string;
  appKey: string;
  apiUrl: string;
  authToken: string;
};

export async function probeB2Get(objectKey: string): Promise<string> {
  const auth = await authorize();
  const attempts = [false, true];
  const results: string[] = [];
  for (const unsignedPayload of attempts) {
    const signed = await signedS3Headers({
      method: "GET",
      endpoint: auth.endpoint,
      region: auth.region,
      bucket: auth.bucket,
      objectKey,
      accessKeyId: auth.keyId,
      secretAccessKey: auth.appKey,
      unsignedPayload,
    });
    const got = await fetch(signed.url, { headers: signed.headers });
    const detail = got.ok ? "" : await got.text();
    const code = got.ok ? "ok" : (/<Code>([^<]+)<\/Code>/.exec(detail)?.[1] ?? "unknown");
    results.push(`${unsignedPayload ? "unsigned" : "empty-hash"} ${got.status} ${code} bytes=${got.ok ? (await got.arrayBuffer()).byteLength : 0}`);
  }
  let listed = "list-skipped";
  if (auth.apiUrl && auth.authToken && auth.bucketId) {
    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: "POST",
      headers: { authorization: auth.authToken, "content-type": "application/json" },
      body: JSON.stringify({ bucketId: auth.bucketId, prefix: objectKey, maxFileCount: 5 }),
    });
    if (!response.ok) listed = `list ${response.status}`;
    else {
      const body = (await response.json()) as { files?: Array<{ fileName?: string }> };
      listed = `list ${body.files?.length ?? 0}`;
    }
  }
  return `bucket=${auth.bucket} ${results.join(" | ")} ${listed}`;
}

export async function uploadOriginToB2(
  originDir: string,
): Promise<{ bucket: string; count: number; read: "ok" | "denied" }> {
  const auth = await authorize();
  const files = await walk(originDir);
  let count = 0;
  let sample: { key: string; size: number } | null = null;
  for (const file of files) {
    const objectKey = path.relative(originDir, file).split(path.sep).join("/");
    if (objectKey.endsWith(".key") || objectKey.includes("..")) continue;
    const body = new Uint8Array(await readFile(file));
    const contentType = objectKey.endsWith(".m3u8")
      ? "application/vnd.apple.mpegurl"
      : "video/mp2t";
    const signed = await signedS3Headers({
      method: "PUT",
      endpoint: auth.endpoint,
      region: auth.region,
      bucket: auth.bucket,
      objectKey,
      accessKeyId: auth.keyId,
      secretAccessKey: auth.appKey,
      body,
      contentType,
    });
    const response = await fetch(signed.url, { method: "PUT", headers: signed.headers, body });
    if (!response.ok) {
      throw new Error(`b2 put failed ${response.status}`);
    }
    if (!sample && body.byteLength > 0 && body.byteLength < 200_000) {
      sample = { key: objectKey, size: body.byteLength };
    }
    count += 1;
  }
  if (sample) {
    const signed = await signedS3Headers({
      method: "GET",
      endpoint: auth.endpoint,
      region: auth.region,
      bucket: auth.bucket,
      objectKey: sample.key,
      accessKeyId: auth.keyId,
      secretAccessKey: auth.appKey,
    });
    const got = await fetch(signed.url, { headers: signed.headers });
    if (!got.ok) {
      const detail = await got.text();
      const code = /<Code>([^<]+)<\/Code>/.exec(detail)?.[1] ?? "unknown";
      if (code === "AccessDenied") {
        return { bucket: auth.bucket, count, read: "denied" as const };
      }
      throw new Error(`b2 get failed ${got.status} ${code}`);
    }
    const read = new Uint8Array(await got.arrayBuffer());
    if (read.byteLength !== sample.size) throw new Error("b2 get length mismatch");
  }
  return { bucket: auth.bucket, count, read: "ok" as const };
}

async function authorize(): Promise<Authorize> {
  const keyId = process.env.B2_KEY_ID || process.env.backblaze_keyID || "";
  const appKey = process.env.B2_APPLICATION_KEY || process.env.backblaze_applicationKey || "";
  if (!keyId || !appKey) throw new Error("b2 credentials are not set");
  let endpoint = process.env.B2_ENDPOINT ?? "";
  let region = process.env.B2_REGION ?? "";
  let bucket = process.env.B2_BUCKET ?? "";
  let bucketId = "";
  let apiUrl = "";
  let authToken = "";
  let accountId = "";
  if (!endpoint || !bucket || !region) {
    const token = btoa(`${keyId}:${appKey}`);
    const response = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
      headers: { authorization: `Basic ${token}` },
    });
    if (!response.ok) throw new Error(`b2 authorize failed ${response.status}`);
    const body = (await response.json()) as {
      accountId?: string;
      apiUrl?: string;
      authorizationToken?: string;
      s3ApiUrl?: string;
      allowed?: { bucketId?: string | null; bucketName?: string | null };
    };
    apiUrl = body.apiUrl ?? "";
    authToken = body.authorizationToken ?? "";
    accountId = body.accountId ?? "";
    endpoint = endpoint || body.s3ApiUrl || "";
    bucket = bucket || body.allowed?.bucketName || "";
    bucketId = body.allowed?.bucketId ?? "";
    if (!bucket) {
      bucket = await chooseBucket(body.apiUrl ?? "", body.authorizationToken ?? "", body.accountId ?? "");
    }
    const host = endpoint ? new URL(endpoint).host : "";
    const match = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(host);
    region = region || match?.[1] || "";
  }
  if (!endpoint || !bucket || !region) throw new Error("b2 bucket is not configured");
  if (!bucketId && apiUrl && authToken && accountId) {
    bucketId = await bucketIdFor(apiUrl, authToken, { accountId, bucket });
  }
  return { bucket, bucketId, endpoint, region, keyId, appKey, apiUrl, authToken };
}

async function bucketIdFor(
  apiUrl: string,
  token: string,
  input: { accountId: string; bucket: string },
): Promise<string> {
  if (!input.accountId) return "";
  const response = await fetch(`${apiUrl}/b2api/v2/b2_list_buckets`, {
    method: "POST",
    headers: { authorization: token, "content-type": "application/json" },
    body: JSON.stringify({ accountId: input.accountId }),
  });
  if (!response.ok) return "";
  const body = (await response.json()) as {
    buckets?: Array<{ bucketId?: string; bucketName?: string }>;
  };
  return body.buckets?.find((bucket) => bucket.bucketName === input.bucket)?.bucketId ?? "";
}

async function chooseBucket(apiUrl: string, token: string, accountId: string): Promise<string> {
  if (!apiUrl || !token || !accountId) return "";
  const response = await fetch(`${apiUrl}/b2api/v2/b2_list_buckets`, {
    method: "POST",
    headers: { authorization: token, "content-type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  if (!response.ok) throw new Error(`b2 list buckets failed ${response.status}`);
  const body = (await response.json()) as { buckets?: Array<{ bucketName?: string }> };
  const names = (body.buckets ?? []).map((bucket) => bucket.bucketName).filter((name): name is string => Boolean(name));
  if (names.length === 1) return names[0];
  const preferred = names.find((name) => /media|edu|vod|luminary/i.test(name));
  if (preferred) return preferred;
  if (names.length === 0) {
    const created = await fetch(`${apiUrl}/b2api/v2/b2_create_bucket`, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ accountId, bucketName: "luminary-vod", bucketType: "allPrivate" }),
    });
    if (!created.ok) throw new Error(`b2 create bucket failed ${created.status}`);
    const row = (await created.json()) as { bucketName?: string };
    return row.bucketName ?? "";
  }
  throw new Error(`b2 bucket is ambiguous: ${names.join(",")}`);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
