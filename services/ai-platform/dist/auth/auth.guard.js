"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthGuard = void 0;
exports.requestPath = requestPath;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const jose_1 = require("jose");
const ai_platform_config_1 = require("../config/ai-platform.config");
const policy_1 = require("../policy");
const decorators_1 = require("./decorators");
const safe_equal_1 = require("./safe-equal");
const auth_types_1 = require("./auth.types");
let AuthGuard = class AuthGuard {
    reflector;
    config;
    jwks = null;
    constructor(reflector, config) {
        this.reflector = reflector;
        this.config = config;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const isPublic = this.reflector.getAllAndOverride(decorators_1.IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        const ingress = (0, policy_1.resolveIngress)(requestPath(req), (0, policy_1.readPublicApiEnabled)());
        if (isPublic || ingress === "open")
            return true;
        if (ingress === "public-disabled")
            throw new common_1.NotFoundException();
        if (ingress === "public-unimplemented") {
            throw new common_1.HttpException({ error: { code: "NOT_IMPLEMENTED", message: "Not implemented" } }, 501);
        }
        const conf = this.config.getOrThrow("aiPlatform");
        const credentials = (0, ai_platform_config_1.credentialsFromConfig)(conf);
        const serviceKey = header(req, "x-service-key");
        if (serviceKey !== undefined) {
            const credential = matchServiceCredential(serviceKey, credentials);
            if (!credential)
                throw authRequired();
            req[auth_types_1.AI_PRINCIPAL] = servicePrincipal(req, credential);
            return true;
        }
        const auth = header(req, "authorization");
        const token = bearer(auth);
        if (!token)
            throw authRequired();
        const asService = matchServiceCredential(token, credentials);
        if (asService) {
            req[auth_types_1.AI_PRINCIPAL] = servicePrincipal(req, asService);
            return true;
        }
        req[auth_types_1.AI_PRINCIPAL] = await this.verifyUserToken(token, conf);
        return true;
    }
    async verifyUserToken(token, conf) {
        if (conf.authMode === "legacy") {
            if (!conf.legacyJwtSecret)
                throw authRequired();
            const { payload } = await (0, jose_1.jwtVerify)(token, new TextEncoder().encode(conf.legacyJwtSecret), {
                algorithms: ["HS256"],
            }).catch(() => {
                throw authRequired();
            });
            return principalFromPayload(payload);
        }
        if (!conf.issuer || !conf.audience || !conf.jwksUri)
            throw authRequired();
        if (!this.jwks)
            this.jwks = (0, jose_1.createRemoteJWKSet)(new URL(conf.jwksUri));
        const { payload } = await (0, jose_1.jwtVerify)(token, this.jwks, {
            issuer: conf.issuer,
            audience: conf.audience,
            algorithms: ["RS256", "ES256"],
        }).catch(() => {
            throw authRequired();
        });
        return principalFromPayload(payload);
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        config_1.ConfigService])
], AuthGuard);
function servicePrincipal(req, credential) {
    return {
        subjectId: header(req, "x-service-subject") ?? "service:internal",
        kind: "service",
        surface: "product",
        organizationId: header(req, "x-organization-id") ?? null,
        productCodes: credential.productCodes,
        internal: credential.internal,
    };
}
function matchServiceCredential(presented, credentials) {
    let matched = null;
    for (const credential of credentials) {
        if (credential.key && (0, safe_equal_1.safeEqualString)(presented, credential.key))
            matched = credential;
    }
    return matched;
}
function principalFromPayload(payload) {
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub)
        throw authRequired();
    const org = (typeof payload.org_id === "string" && payload.org_id) ||
        (typeof payload.orgId === "string" && payload.orgId) ||
        null;
    return { subjectId: sub, kind: "user", surface: "product", organizationId: org };
}
function authRequired() {
    return new common_1.UnauthorizedException({
        error: { code: "AUTH_REQUIRED", message: "Authentication required" },
    });
}
function requestPath(req) {
    return req.raw?.url ?? req.url ?? "/";
}
function header(req, name) {
    const value = req.headers[name] ?? req.headers[name.toLowerCase()];
    if (Array.isArray(value))
        return value[0];
    return value;
}
function bearer(value) {
    if (!value)
        return undefined;
    return value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : undefined;
}
