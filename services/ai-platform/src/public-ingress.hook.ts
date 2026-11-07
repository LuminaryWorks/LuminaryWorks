import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { readPublicApiEnabled, resolveIngress } from "./policy";

/**
 * `/v1/public/*` is reserved. The switch is checked before routing so a closed
 * API answers 404 (the path does not advertise itself) and an open API answers
 * 501 until a later phase implements it. Product routes are not hooked.
 */
@Injectable()
export class PublicIngressHook implements OnApplicationBootstrap {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onApplicationBootstrap(): void {
    const fastify = this.adapterHost.httpAdapter.getInstance() as {
      addHook: (
        name: "onRequest",
        hook: (request: { url: string }, reply: FastifyReplyLike) => Promise<void>,
      ) => void;
    };
    fastify.addHook("onRequest", async (request, reply) => {
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

interface FastifyReplyLike {
  code: (status: number) => { send: (body: unknown) => Promise<unknown> };
}
