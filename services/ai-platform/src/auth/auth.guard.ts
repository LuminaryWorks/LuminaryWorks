import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { credentialsFromConfig, type AiPlatformConfig, type ServiceCredential } from "../config/ai-platform.config";
import { readPublicApiEnabled, refreshPublicApiEnabled, resolveIngress } from "../policy";
import { IS_PUBLIC_KEY } from "./decorators";
import { safeEqualString } from "./safe-equal";
import { AI_PRINCIPAL, type AiPrincipal, type AuthedRequest } from "./auth.types";

@Injectable()
export class AuthGuard implements CanActivate {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    await refreshPublicApiEnabled();
    const ingress = resolveIngress(requestPath(req), readPublicApiEnabled());
    if (isPublic || ingress === "open") return true;
    if (ingress === "public-disabled") throw new NotFoundException();
    if (ingress === "public-unimplemented") {
      throw new HttpException(
        { error: { code: "NOT_IMPLEMENTED", message: "Not implemented" } },
        501,
      );
    }

    const conf = this.config.getOrThrow<AiPlatformConfig>("aiPlatform");
    const credentials = credentialsFromConfig(conf);
    const serviceKey = header(req, "x-service-key");
    if (serviceKey !== undefined) {
      const credential = matchServiceCredential(serviceKey, credentials);
      if (!credential) throw authRequired();
      req[AI_PRINCIPAL] = servicePrincipal(req, credential);
      return true;
    }

    const auth = header(req, "authorization");
    const token = bearer(auth);
    if (!token) throw authRequired();
    const asService = matchServiceCredential(token, credentials);
    if (asService) {
      req[AI_PRINCIPAL] = servicePrincipal(req, asService);
      return true;
    }

    req[AI_PRINCIPAL] = await this.verifyUserToken(token, conf);
    return true;
  }

  private async verifyUserToken(token: string, conf: AiPlatformConfig): Promise<AiPrincipal> {
    if (conf.authMode === "legacy") {
      if (!conf.legacyJwtSecret) throw authRequired();
      const { payload } = await jwtVerify(token, new TextEncoder().encode(conf.legacyJwtSecret), {
        algorithms: ["HS256"],
      }).catch(() => {
        throw authRequired();
      });
      return principalFromPayload(payload);
    }

    if (!conf.issuer || !conf.audience || !conf.jwksUri) throw authRequired();
    if (!this.jwks) this.jwks = createRemoteJWKSet(new URL(conf.jwksUri));
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: conf.issuer,
      audience: conf.audience,
      algorithms: ["RS256", "ES256"],
    }).catch(() => {
      throw authRequired();
    });
    return principalFromPayload(payload);
  }
}

function servicePrincipal(req: AuthedRequest, credential: ServiceCredential): AiPrincipal {
  return {
    subjectId: header(req, "x-service-subject") ?? "service:internal",
    kind: "service",
    surface: "product",
    organizationId: header(req, "x-organization-id") ?? null,
    productCodes: credential.productCodes,
    internal: credential.internal,
  };
}

function matchServiceCredential(presented: string, credentials: readonly ServiceCredential[]): ServiceCredential | null {
  let matched: ServiceCredential | null = null;
  for (const credential of credentials) {
    if (credential.key && safeEqualString(presented, credential.key)) matched = credential;
  }
  return matched;
}

function principalFromPayload(payload: Record<string, unknown>): AiPrincipal {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) throw authRequired();
  const org =
    (typeof payload.org_id === "string" && payload.org_id) ||
    (typeof payload.orgId === "string" && payload.orgId) ||
    null;
  return { subjectId: sub, kind: "user", surface: "product", organizationId: org };
}

function authRequired(): UnauthorizedException {
  return new UnauthorizedException({
    error: { code: "AUTH_REQUIRED", message: "Authentication required" },
  });
}

export function requestPath(req: AuthedRequest): string {
  return req.raw?.url ?? req.url ?? "/";
}

function header(req: AuthedRequest, name: string): string | undefined {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function bearer(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : undefined;
}
