import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AiGatewayService } from "./ai-gateway.service";
import type { ConnectionOwnerKind } from "./database/entities/provider-connection.entity";
import { AI_PRINCIPAL, type AiPrincipal, type AuthedRequest } from "./auth/auth.types";

@Controller()
export class AiGatewayController {
  constructor(private readonly ai: AiGatewayService) {}

  @Get("v1/providers")
  async providers(
    @Req() req: AuthedRequest,
    @Query("ownerKind") ownerKind?: string,
    @Query("ownerUid") ownerUid?: string,
    @Query("productCode") productCode?: string,
  ) {
    return {
      items: await this.ai.listConnections(principalOf(req), {
        ownerKind: ownerKind as ConnectionOwnerKind | undefined,
        ownerUid,
        productCode,
      }),
      types: ["deepseek", "doubao", "openai", "openai-compatible", "anthropic", "gemini"],
    };
  }

  @Post("v1/providers")
  upsert(@Body() body: Parameters<AiGatewayService["upsertConnection"]>[0], @Req() req: AuthedRequest) {
    return this.ai.upsertConnection(body, principalOf(req));
  }

  @Patch("v1/providers/:uid")
  update(
    @Param("uid") uid: string,
    @Body() body: Parameters<AiGatewayService["updateConnection"]>[1],
    @Req() req: AuthedRequest,
  ) {
    return this.ai.updateConnection(uid, body, principalOf(req));
  }

  @Delete("v1/providers/:uid")
  remove(@Param("uid") uid: string, @Req() req: AuthedRequest) {
    return this.ai.deleteConnection(uid, principalOf(req));
  }

  /** Connectivity probe. Body is `{ connectionUid }` or `{ ephemeral }`. Never echoes the secret. */
  @Post("v1/providers/test")
  @HttpCode(200)
  test(@Body() body: Parameters<AiGatewayService["testConnection"]>[0], @Req() req: AuthedRequest) {
    return this.ai.testConnection(body, principalOf(req));
  }

  /** Model list for a saved connection or an unsaved `{ providerType, baseUrl, secret }` payload. */
  @Post("v1/providers/models")
  @HttpCode(200)
  models(@Body() body: Parameters<AiGatewayService["listModels"]>[0], @Req() req: AuthedRequest) {
    return this.ai.listModels(body, principalOf(req));
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
