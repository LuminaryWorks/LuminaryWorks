import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { safeEqualString } from "../crypto/seal";
import type { NotificationConfig } from "../config/notification.config";

@Injectable()
export class ServiceKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = request.headers.authorization;
    const raw = Array.isArray(header) ? (header[0] ?? "") : (header ?? "");
    const token = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length) : raw;
    const expected = this.config.getOrThrow<NotificationConfig>("notification").serviceKey;
    if (!expected || !safeEqualString(token, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
