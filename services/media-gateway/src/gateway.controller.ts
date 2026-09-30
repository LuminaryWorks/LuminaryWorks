import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { GatewayError } from "./gateway.error";
import { GatewayService, type RegisterBody } from "./gateway.service";

@Controller()
export class GatewayController {
  constructor(private readonly gateway: GatewayService) {}

  @Get("health")
  health(): { status: "ok"; service: string } {
    return { status: "ok", service: "media-gateway" };
  }

  @Post("v1/assets")
  @HttpCode(201)
  register(@Req() req: FastifyRequest, @Body() body: RegisterBody) {
    this.gateway.assertServiceKey(req.headers.authorization);
    return this.gateway.register(body);
  }

  @Post("v1/sessions")
  @HttpCode(201)
  createSession(
    @Req() req: FastifyRequest,
    @Body() body: { tenant?: string; assetId?: string; subjectId?: string },
  ) {
    this.gateway.assertServiceKey(req.headers.authorization);
    return this.gateway.createSession(body, req.ip || "unknown");
  }

  @Post("v1/sessions/:sessionId/renew")
  renew(
    @Req() req: FastifyRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: { subjectId?: string },
  ) {
    this.gateway.assertServiceKey(req.headers.authorization);
    return this.gateway.renew(sessionId, (body.subjectId ?? "").trim());
  }

  @Get("v1/playback/:sessionId/index.m3u8")
  async master(
    @Param("sessionId") sessionId: string,
    @Query() query: Record<string, string | undefined>,
    @Res() reply: FastifyReply,
  ) {
    const text = await this.gateway.masterPlaylist(sessionId, toParams(query));
    return sendPlaylist(reply, text);
  }

  @Get("v1/playback/:sessionId/:variant/index.m3u8")
  async media(
    @Param("sessionId") sessionId: string,
    @Param("variant") variant: string,
    @Query() query: Record<string, string | undefined>,
    @Res() reply: FastifyReply,
  ) {
    const text = await this.gateway.mediaPlaylist(sessionId, variant, toParams(query));
    return sendPlaylist(reply, text);
  }

  @Get("v1/keys/:keyId")
  async key(
    @Param("keyId") keyId: string,
    @Query() query: Record<string, string | undefined>,
    @Res() reply: FastifyReply,
  ) {
    const bytes = await this.gateway.readKey(keyId, toParams(query));
    reply.header("cache-control", "private, no-store");
    reply.header("access-control-allow-origin", "*");
    reply.type("application/octet-stream");
    return reply.send(Buffer.from(bytes));
  }
}

function toParams(query: Record<string, string | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.set(key, value);
  }
  return params;
}

function sendPlaylist(reply: FastifyReply, text: string) {
  reply.header("cache-control", "private, no-store");
  reply.header("access-control-allow-origin", "*");
  reply.type("application/vnd.apple.mpegurl; charset=utf-8");
  return reply.send(text);
}

export function statusFor(error: unknown): { status: number; body: { code: string; message: string } } {
  if (error instanceof GatewayError) {
    return { status: error.status, body: { code: error.code, message: error.message } };
  }
  return { status: 500, body: { code: "INTERNAL", message: "internal error" } };
}
