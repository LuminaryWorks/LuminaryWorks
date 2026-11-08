import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { readCorsOrigins, readPublicApiEnabled, refreshPublicApiEnabled, resolveIngress } from "./policy";

const CORS_HEADERS = "Authorization, Content-Type, X-Service-Key, X-Service-Subject, X-Organization-Id";
const CORS_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";

/**
 * `/v1/public/*` is reserved. The switch is checked before routing so a closed
 * API answers 404 (the path does not advertise itself) and an open API answers
 * 501 until a later phase implements it. Product routes are not hooked.
 *
 * CORS is read on each request from AI_PLATFORM_CORS_ORIGINS (comma-separated
 * exact origins). Empty means no CORS headers, which is the production default.
 * A matching Origin may call the API with an OIDC bearer token. `*` is ignored.
 */
@Injectable()
export class PublicIngressHook implements OnApplicationBootstrap {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onApplicationBootstrap(): void {
    const fastify = this.adapterHost.httpAdapter.getInstance() as {
      addHook: (
        name: "onRequest",
        hook: (request: HookRequest, reply: FastifyReplyLike) => Promise<void>,
      ) => void;
    };
    fastify.addHook("onRequest", async (request, reply) => {
      if (await applyCors(request, reply)) return;
      await refreshPublicApiEnabled();
      const ingress = resolveIngress(request.url, readPublicApiEnabled());
      if (ingress === "public-disabled") {
        await reply.code(404).send({ statusCode: 404, error: "Not Found", message: "Not Found" });
        return;
      }
      if (ingress === "public-unimplemented") {
        await reply.code(501).send({ error: { code: "NOT_IMPLEMENTED", message: "Not implemented" } });
      }
    });
  }
}

async function applyCors(request: HookRequest, reply: FastifyReplyLike): Promise<boolean> {
  const origin = header(request, "origin");
  if (!origin) return false;
  const allowed = readCorsOrigins().includes(origin);
  if (allowed) {
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Vary", "Origin");
    reply.header("Access-Control-Allow-Credentials", "true");
    reply.header("Access-Control-Allow-Headers", CORS_HEADERS);
    reply.header("Access-Control-Allow-Methods", CORS_METHODS);
    reply.header("Access-Control-Max-Age", "600");
  }
  if (request.method !== "OPTIONS") return false;
  if (!allowed) {
    await reply.code(403).send({ error: { code: "FORBIDDEN", message: "origin is not allowed" } });
    return true;
  }
  await reply.code(204).send();
  return true;
}

function header(request: HookRequest, name: string): string | undefined {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

interface HookRequest {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

interface FastifyReplyLike {
  header: (name: string, value: string) => void;
  code: (status: number) => { send: (body?: unknown) => Promise<unknown> };
}
