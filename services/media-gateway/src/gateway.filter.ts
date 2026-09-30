import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { statusFor } from "./gateway.controller";

@Catch()
export class GatewayFilter implements ExceptionFilter {
  private readonly logger = new Logger(GatewayFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const { status, body } = statusFor(error);
    if (status >= 500) {
      this.logger.error(error instanceof Error ? error.message : "internal error");
    }
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply.status(status).send(body);
  }
}
