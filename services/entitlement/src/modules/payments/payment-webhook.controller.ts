import { Controller, Headers, Param, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { REQUEST_RAW_BODY_KEY } from "../../auth/auth.types";
import { Public } from "../../auth/decorators";
import { EntitlementException } from "../../common/errors";
import { requestHeaders } from "../../common/payment-geo";
import { PaymentWebhookService } from "./payment-webhook.service";

@ApiTags("payments")
@Controller("v1/payments/webhooks")
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Public()
  @Post(":provider/:configId")
  async inbound(
    @Param("provider") provider: string,
    @Param("configId") configId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: { [REQUEST_RAW_BODY_KEY]?: Buffer; body?: unknown },
    @Res() reply: FastifyReply,
  ) {
    const raw = req[REQUEST_RAW_BODY_KEY];
    if (!Buffer.isBuffer(raw)) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Missing raw request body");
    }
    const result = await this.webhooks.handlePublic({
      provider,
      configId,
      rawBody: raw,
      headers: requestHeaders(headers),
    });
    const status = result.status ?? 200;
    if (typeof result.body === "string") {
      return reply.status(status).type("text/plain; charset=utf-8").send(result.body);
    }
    return reply.status(status).type("application/json; charset=utf-8").send(result.body);
  }
}
