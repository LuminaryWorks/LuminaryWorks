import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AuthPrincipal } from "./auth.types";
import { REQUEST_PRINCIPAL_KEY } from "./auth.types";

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const req = ctx.switchToHttp().getRequest<{ [REQUEST_PRINCIPAL_KEY]?: AuthPrincipal }>();
    const principal = req[REQUEST_PRINCIPAL_KEY];
    if (!principal) {
      throw new Error("Missing auth principal on request");
    }
    return principal;
  },
);

export const IS_PUBLIC_KEY = "entitlement:public";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRES_ADMIN_KEY = "entitlement:admin";
export const RequireAdmin = () => SetMetadata(REQUIRES_ADMIN_KEY, true);

export const REQUIRES_PARTNER_SCOPES_KEY = "entitlement:partner-scopes";
export const RequirePartnerScopes = (...scopes: string[]) =>
  SetMetadata(REQUIRES_PARTNER_SCOPES_KEY, scopes);
