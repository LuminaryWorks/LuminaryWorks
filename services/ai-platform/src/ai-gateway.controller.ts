import { Body, Controller, Get, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AiGatewayService } from "./ai-gateway.service";

@Controller()
export class AiGatewayController {
  constructor(private readonly ai: AiGatewayService) {}

  @Get("v1/health")
  health() {
    return { ok: true, service: "luminary-ai-platform" };
  }

  @Get("v1/providers")
  providers() {
    return {
      items: this.ai.listConnections(),
      types: ["deepseek", "doubao", "openai", "openai-compatible", "anthropic", "gemini"],
    };
  }

  @Post("v1/providers")
  upsert(@Body() body: Parameters<AiGatewayService["upsertConnection"]>[0]) {
    return this.ai.upsertConnection(body);
  }

  @Post("v1/providers/test")
  async test(
    @Body()
    body: {
      ephemeral: { providerType: string; model: string; secret: string; baseUrl?: string };
    },
  ) {
    const result = await this.ai.complete({
      ephemeral: body.ephemeral,
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 8,
    });
    return { ok: true, model: result.model, providerType: result.providerType };
  }

  @Post("v1/chat/complete")
  complete(@Body() body: Parameters<AiGatewayService["complete"]>[0]) {
    return this.ai.complete(body);
  }

  @Post("v1/chat/stream")
  async stream(
    @Body() body: Parameters<AiGatewayService["stream"]>[0],
    @Res() reply: FastifyReply,
  ) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    try {
      for await (const ev of this.ai.stream(body)) {
        reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (err) {
      reply.raw.write(
        `data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) })}\n\n`,
      );
    }
    reply.raw.end();
  }

  @Post("v1/embeddings")
  embed(@Body() body: { texts: string[] }) {
    return this.ai.embed(body.texts ?? []);
  }

  @Post("v1/audio/transcribe")
  transcribe() {
    return { text: "", traceId: `trc_stt_${Date.now().toString(36)}`, status: "not_configured" };
  }

  @Post("v1/audio/synthesize")
  synthesize() {
    return { audioBase64: "", mime: "audio/mpeg", traceId: `trc_tts_${Date.now().toString(36)}`, status: "not_configured" };
  }

  @Get("v1/usage")
  usage() {
    return { items: this.ai.listUsage() };
  }
}
