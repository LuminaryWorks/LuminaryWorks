import { Body, Controller, Get, HttpException, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AiGatewayService, type EphemeralSecret } from "./ai-gateway.service";
import { AI_PRINCIPAL, type AiPrincipal, type AuthedRequest } from "./auth/auth.types";

@Controller()
export class AiGatewayController {
  constructor(private readonly ai: AiGatewayService) {}

  @Get("v1/providers")
  async providers(@Req() req: AuthedRequest) {
    return {
      items: await this.ai.listConnections(principalOf(req)),
      types: ["deepseek", "doubao", "openai", "openai-compatible", "anthropic", "gemini"],
    };
  }

  @Post("v1/providers")
  upsert(@Body() body: Parameters<AiGatewayService["upsertConnection"]>[0], @Req() req: AuthedRequest) {
    return this.ai.upsertConnection(body, principalOf(req));
  }

  @Post("v1/providers/test")
  test(
    @Body()
    body: {
      ephemeral: EphemeralSecret;
      subjectId?: string;
      organizationId?: string | null;
      productCode?: string;
    },
    @Req() req: AuthedRequest,
  ) {
    return this.ai.complete(
      {
        ephemeral: body.ephemeral,
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 8,
        subjectId: body.subjectId,
        organizationId: body.organizationId,
        productCode: body.productCode,
      },
      { allowEphemeral: true, surface: surfaceOf(req), principal: principalOf(req) },
    );
  }

  @Post("v1/chat/complete")
  complete(
    @Body() body: Parameters<AiGatewayService["complete"]>[0],
    @Req() req: AuthedRequest,
  ) {
    return this.ai.complete(body, { surface: surfaceOf(req), principal: principalOf(req) });
  }

  @Post("v1/chat/stream")
  async stream(
    @Body() body: Parameters<AiGatewayService["openStream"]>[0],
    @Req() req: AuthedRequest,
    @Res() reply: FastifyReply,
  ) {
    try {
      const events = await this.ai.openStream(body, { surface: surfaceOf(req), principal: principalOf(req) });
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      for await (const ev of events) {
        reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (err) {
      if (reply.raw.headersSent) {
        reply.raw.write(
          `data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) })}\n\n`,
        );
        reply.raw.end();
        return;
      }
      const status = err instanceof HttpException ? err.getStatus() : 500;
      const payload =
        err instanceof HttpException
          ? err.getResponse()
          : { message: err instanceof Error ? err.message : String(err) };
      reply.status(status).send(payload);
      return;
    }
    reply.raw.end();
  }

  @Post("v1/embeddings")
  embed(@Body() body: { texts: string[] }) {
    return this.ai.embed(body.texts ?? []);
  }

  @Post("v1/audio/transcribe")
  transcribe(
    @Body()
    body: Parameters<AiGatewayService["transcribe"]>[0],
    @Req() req: AuthedRequest,
  ) {
    return this.ai.transcribe(body, { surface: surfaceOf(req), principal: principalOf(req) });
  }

  @Post("v1/audio/synthesize")
  synthesize(
    @Body()
    body: Parameters<AiGatewayService["synthesize"]>[0],
    @Req() req: AuthedRequest,
  ) {
    return this.ai.synthesize(body, { surface: surfaceOf(req), principal: principalOf(req) });
  }

  @Get("v1/usage")
  usage(@Req() req: AuthedRequest) {
    return this.ai.listUsage(principalOf(req)).then((items) => ({ items }));
  }
}

function principalOf(req: AuthedRequest): AiPrincipal {
  const principal = req[AI_PRINCIPAL];
  if (!principal) {
    throw new UnauthorizedException({
      error: { code: "AUTH_REQUIRED", message: "Authentication required" },
    });
  }
  return principal;
}

function surfaceOf(req: AuthedRequest): "product" | "public" {
  const principal = req[AI_PRINCIPAL] as AiPrincipal | undefined;
  return principal?.surface === "public" ? "public" : "product";
}
