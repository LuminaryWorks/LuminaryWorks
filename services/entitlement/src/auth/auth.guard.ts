import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { safeEqualString } from "../common/crypto";
import { EntitlementException } from "../common/errors";
import type { EntitlementConfig } from "../config/entitlement.config";
import type { AuthPrincipal } from "./auth.types";
import { REQUEST_ID_KEY, REQUEST_PRINCIPAL_KEY } from "./auth.types";
import { IS_PUBLIC_KEY, REQUIRES_ADMIN_KEY, REQUIRES_PARTNER_SCOPES_KEY } from "./decorators";

type AuthedRequest = {
  headers: Record<string, string | string[] | undefined>;
  [REQUEST_PRINCIPAL_KEY]?: AuthPrincipal;
  [REQUEST_ID_KEY]?: string;
};

@Injectable()
export class AuthGuard implements CanActivate {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  private getConf(): EntitlementConfig {
    return this.config.getOrThrow<EntitlementConfig>("entitlement");
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    req[REQUEST_ID_KEY] =
      header(req, "x-request-id") ?? header(req, "x-correlation-id") ?? cryptoRandom();

    const conf = this.getConf();
    const serviceKey = header(req, "x-service-key") ?? header(req, "x-entitlement-service-key");
    if (serviceKey && conf.serviceApiKey && safeEqualString(serviceKey, conf.serviceApiKey)) {
      const principal: AuthPrincipal = {
        subjectId: header(req, "x-service-subject") ?? "service:internal",
        kind: "service",
        scopes: [...conf.adminScopes, "entitlement:service"],
        organizationId: header(req, "x-organization-id") ?? null,
        actAsSubjectId: header(req, "x-act-as-subject") ?? null,
      };
      req[REQUEST_PRINCIPAL_KEY] = principal;
      return this.enforceRoleIfNeeded(context, principal);
    }

    const auth = header(req, "authorization");
    if (!auth?.startsWith("Bearer ")) {
      throw new UnauthorizedException({
        error: {
          code: "UNAUTHORIZED",
          message: "Missing Bearer token or service credential",
          httpStatus: 401,
        },
      });
    }
    const token = auth.slice("Bearer ".length).trim();
    const principal = await this.verifyToken(token, conf);
    const actAs = header(req, "x-act-as-subject");
    if (actAs && (principal.kind === "admin" || principal.kind === "service")) {
      principal.actAsSubjectId = actAs;
    }
    req[REQUEST_PRINCIPAL_KEY] = principal;
    return this.enforceRoleIfNeeded(context, principal);
  }

  private enforceRoleIfNeeded(context: ExecutionContext, principal: AuthPrincipal): boolean {
    const needsAdmin = this.reflector.getAllAndOverride<boolean>(REQUIRES_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (needsAdmin) {
      const conf = this.getConf();
      const ok =
        principal.kind === "service" ||
        principal.kind === "admin" ||
        conf.adminScopes.some((s) => principal.scopes.includes(s));
      if (!ok) {
        throw new EntitlementException("FORBIDDEN", "Admin or service credential required");
      }
      return true;
    }

    const partnerScopes = this.reflector.getAllAndOverride<string[]>(REQUIRES_PARTNER_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (partnerScopes?.length) {
      if (principal.kind === "service" || principal.kind === "admin") return true;
      if (principal.kind !== "partner") {
        throw new EntitlementException("FORBIDDEN", "Partner credential required");
      }
      const missing = partnerScopes.filter((s) => !principal.scopes.includes(s));
      if (missing.length) {
        throw new EntitlementException("FORBIDDEN", `Missing partner scopes: ${missing.join(",")}`);
      }
    }
    return true;
  }

  private async verifyToken(token: string, conf: EntitlementConfig): Promise<AuthPrincipal> {
    // Partner M2M tokens (HS256, typ=partner)
    try {
      const partner = await this.tryPartnerToken(token, conf);
      if (partner) return partner;
    } catch {
      // fall through to user/OIDC
    }

    if (conf.authMode === "legacy") {
      const { jwtVerify: localVerify } = await import("jose");
      const secret = new TextEncoder().encode(conf.legacyJwtSecret ?? "dev");
      const { payload } = await localVerify(token, secret).catch(() => {
        throw new UnauthorizedException({
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid legacy token",
            httpStatus: 401,
          },
        });
      });
      return principalFromPayload(payload);
    }

    if (!conf.issuer) {
      throw new UnauthorizedException({
        error: {
          code: "UNAUTHORIZED",
          message: "OIDC issuer not configured",
          httpStatus: 401,
        },
      });
    }
    const jwksUri = conf.jwksUri ?? `${conf.issuer.replace(/\/$/, "")}/jwks`;
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(jwksUri));
    }
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: conf.issuer,
      audience: conf.audience,
    }).catch(() => {
      throw new UnauthorizedException({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid OIDC token",
          httpStatus: 401,
        },
      });
    });
    return principalFromPayload(payload);
  }

  private async tryPartnerToken(
    token: string,
    conf: EntitlementConfig,
  ): Promise<AuthPrincipal | null> {
    const { jwtVerify: localVerify, decodeProtectedHeader } = await import("jose");
    let header: { typ?: string };
    try {
      header = decodeProtectedHeader(token) as { typ?: string };
    } catch {
      return null;
    }
    if (header.typ !== "partner+jwt") return null;
    const secret = new TextEncoder().encode(conf.partnerTokenSecret);
    const { payload } = await localVerify(token, secret, {
      audience: "entitlement:partner",
    });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const partnerId = typeof payload.partner_id === "string" ? payload.partner_id : null;
    const partnerCode = typeof payload.partner_code === "string" ? payload.partner_code : null;
    if (!sub || !partnerId) {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "Invalid partner token", httpStatus: 401 },
      });
    }
    const scopeStr = typeof payload.scope === "string" ? payload.scope : "";
    return {
      subjectId: sub,
      kind: "partner",
      scopes: scopeStr.split(/\s+/).filter(Boolean),
      partnerId,
      partnerCode,
    };
  }
}

function principalFromPayload(payload: Record<string, unknown>): AuthPrincipal {
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) {
    throw new UnauthorizedException({
      error: {
        code: "UNAUTHORIZED",
        message: "Token missing sub",
        httpStatus: 401,
      },
    });
  }
  const scopeStr =
    typeof payload.scope === "string"
      ? payload.scope
      : Array.isArray(payload.scopes)
        ? (payload.scopes as string[]).join(" ")
        : "";
  const scopes = scopeStr.split(/\s+/).filter(Boolean);
  const orgId =
    (typeof payload.org_id === "string" && payload.org_id) ||
    (typeof payload.orgId === "string" && payload.orgId) ||
    null;
  const isAdmin = scopes.some((s) => s.includes("entitlement:admin"));
  return {
    subjectId: sub,
    kind: isAdmin ? "admin" : "user",
    scopes,
    organizationId: orgId,
  };
}

function header(req: AuthedRequest, name: string): string | undefined {
  const v = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function cryptoRandom(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
