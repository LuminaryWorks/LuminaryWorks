export type GatewayConfig = {
  port: number;
  serviceKey: string;
  signingSecret: string;
  dataDir: string;
  redisUrl: string;
  gatewayBase: string;
  edgeBase: string;
  sessionTtlSec: number;
  trustProxy: boolean;
  limits: {
    ipPerMin: number;
    subjectPer10Min: number;
    renewPerMin: number;
    keyPerMin: number;
  };
};

function requiredSecret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name] ?? "";
  if (value.length < 16) {
    throw new Error(`${name} must be at least 16 characters`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    port: Number(env.PORT ?? 8090),
    serviceKey: requiredSecret(env, "MEDIA_GATEWAY_SERVICE_KEY"),
    signingSecret: requiredSecret(env, "MEDIA_GATEWAY_SIGNING_SECRET"),
    dataDir: env.MEDIA_DATA_DIR ?? "data",
    redisUrl: env.REDIS_URL ?? "",
    gatewayBase: (env.MEDIA_GATEWAY_PUBLIC_BASE ?? "http://127.0.0.1:8090").replace(/\/$/, ""),
    edgeBase: (env.MEDIA_EDGE_BASE ?? "http://127.0.0.1:8091").replace(/\/$/, ""),
    sessionTtlSec: Number(env.MEDIA_SESSION_TTL_SEC ?? 1200),
    trustProxy: env.MEDIA_TRUST_PROXY === "1",
    limits: {
      ipPerMin: Number(env.MEDIA_LIMIT_IP_PER_MIN ?? 30),
      subjectPer10Min: Number(env.MEDIA_LIMIT_SUBJECT_PER_10MIN ?? 10),
      renewPerMin: Number(env.MEDIA_LIMIT_RENEW_PER_MIN ?? 30),
      keyPerMin: Number(env.MEDIA_LIMIT_KEY_PER_MIN ?? 120),
    },
  };
}
