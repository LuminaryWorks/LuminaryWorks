import { handleEdgeRequest } from "./edge-handler";
import { signedS3Headers } from "./s3sig";

type EdgeEnv = {
  MEDIA_GATEWAY_SIGNING_SECRET: string;
  MEDIA_SESSION_TTL_SEC?: string;
  B2_ENDPOINT: string;
  B2_REGION: string;
  B2_BUCKET: string;
  B2_KEY_ID: string;
  B2_APPLICATION_KEY: string;
};

declare const caches: {
  default: {
    match(request: Request): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
  };
};

async function readObject(env: EdgeEnv, objectKey: string): Promise<Uint8Array | null> {
  const cacheKey = new Request(`https://origin.invalid/${objectKey}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const signed = await signedS3Headers({
    method: "GET",
    endpoint: env.B2_ENDPOINT,
    region: env.B2_REGION,
    bucket: env.B2_BUCKET,
    objectKey,
    accessKeyId: env.B2_KEY_ID,
    secretAccessKey: env.B2_APPLICATION_KEY,
  });
  const upstream = await fetch(signed.url, { headers: signed.headers });
  if (upstream.status === 404) return null;
  if (!upstream.ok) return null;
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  await caches.default.put(
    cacheKey,
    new Response(bytes, { headers: { "cache-control": "public, max-age=86400" } }),
  );
  return bytes;
}

export default {
  async fetch(request: Request, env: EdgeEnv): Promise<Response> {
    const ttl = Number(env.MEDIA_SESSION_TTL_SEC ?? 1200);
    return handleEdgeRequest(request, {
      secret: env.MEDIA_GATEWAY_SIGNING_SECRET,
      clientIp: request.headers.get("cf-connecting-ip") ?? "unknown",
      maxTtlSec: ttl + 120,
      origin: { get: (objectKey) => readObject(env, objectKey) },
    });
  },
};
