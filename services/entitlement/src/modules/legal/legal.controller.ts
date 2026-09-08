import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal } from "../../auth/decorators";
import { resolveTrustedSubject } from "../../auth/principal-context";
import { AcceptPolicyDto } from "../../common/dto";
import { LegalService } from "./legal.service";

type RequestMeta = {
  [REQUEST_ID_KEY]?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  const raw = headers?.[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function clientIp(req: RequestMeta): string | null {
  const raw = req.ip ?? req.socket?.remoteAddress ?? null;
  return raw ? String(raw).slice(0, 64) : null;
}

function clientUserAgent(req: RequestMeta): string | null {
  const ua = headerValue(req.headers, "user-agent");
  return ua ? ua.slice(0, 512) : null;
}

@ApiTags("policies")
@ApiBearerAuth()
@Controller("v1/policies")
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get("current")
  getCurrent(@CurrentPrincipal() principal: AuthPrincipal) {
    const subject = resolveTrustedSubject(principal);
    return this.legal.getCurrentManifest(subject.subjectId);
  }

  @Post("accept")
  accept(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: AcceptPolicyDto,
    @Req() req: RequestMeta,
  ) {
    const subject = resolveTrustedSubject(principal);
    return this.legal.accept({
      logtoSub: subject.subjectId,
      policyVersion: body.policyVersion,
      documentKeys: body.documentKeys,
      ip: clientIp(req),
      userAgent: clientUserAgent(req),
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }
}
