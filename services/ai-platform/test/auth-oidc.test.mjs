import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { AuthGuard } from "../dist/auth/auth.guard.js";
import { loadAiPlatformConfig } from "../dist/config/ai-platform.config.js";

test("OIDC bearer JWT is accepted and a bad token is AUTH_REQUIRED", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const issuer = "https://id.example.test";
  const audience = "https://ai.luminaryworks.dev";
  const guard = new AuthGuard(
    { getAllAndOverride: () => false },
    {
      getOrThrow: () => ({
        serviceApiKey: "service-key-0123456789",
        authMode: "oidc",
        issuer,
        audience,
        jwksUri: `http://127.0.0.1:${port}/jwks`,
        legacyJwtSecret: "",
      }),
    },
  );

  const token = await new SignJWT({ sub: "user-oidc" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime("5m")
    .sign(privateKey);

  const req = { headers: { authorization: `Bearer ${token}` }, url: "/v1/providers" };
  const ok = await guard.canActivate(context(req));
  assert.equal(ok, true);
  assert.equal(req.aiPrincipal.subjectId, "user-oidc");
  assert.equal(req.aiPrincipal.surface, "product");

  await assert.rejects(
    () =>
      guard.canActivate(
        context({ headers: { authorization: "Bearer not-a-jwt" }, url: "/v1/providers" }),
      ),
    (error) => error.getResponse().error.code === "AUTH_REQUIRED",
  );

  const forged = await new SignJWT({ sub: "attacker" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode("dev-ai-platform-secret-change-me"));
  await assert.rejects(
    () =>
      guard.canActivate(
        context({ headers: { authorization: `Bearer ${forged}` }, url: "/v1/providers" }),
      ),
    (error) => error.getResponse().error.code === "AUTH_REQUIRED",
  );
  server.close();
});

test("unconfigured oidc rejects startup and legacy is explicit-only", () => {
  assert.throws(() => loadAiPlatformConfig({}), /AI_PLATFORM_OIDC_ISSUER is required/);
  assert.throws(
    () =>
      loadAiPlatformConfig({
        AI_PLATFORM_OIDC_ISSUER: "https://id.example.test/oidc",
        AI_PLATFORM_OIDC_AUDIENCE: "https://ai.luminaryworks.dev",
      }),
    /AI_PLATFORM_JWKS_URI is required/,
  );
  assert.throws(
    () =>
      loadAiPlatformConfig({
        AI_PLATFORM_OIDC_ISSUER: "https://id.example.test/oidc",
        AI_PLATFORM_JWKS_URI: "https://id.example.test/oidc/jwks",
      }),
    /AI_PLATFORM_OIDC_AUDIENCE is required/,
  );
  assert.throws(
    () => loadAiPlatformConfig({ AI_PLATFORM_AUTH_MODE: "legacy" }),
    /AI_PLATFORM_LEGACY_JWT_SECRET is required/,
  );
  assert.throws(
    () =>
      loadAiPlatformConfig({
        NODE_ENV: "production",
        AI_PLATFORM_AUTH_MODE: "legacy",
        AI_PLATFORM_LEGACY_JWT_SECRET: "explicit-secret-0123456789",
      }),
    /legacy is not allowed when NODE_ENV=production/,
  );
  const legacy = loadAiPlatformConfig({
    NODE_ENV: "test",
    AI_PLATFORM_AUTH_MODE: "legacy",
    AI_PLATFORM_LEGACY_JWT_SECRET: "explicit-secret-0123456789",
  });
  assert.equal(legacy.authMode, "legacy");
  assert.equal(legacy.legacyJwtSecret, "explicit-secret-0123456789");
  assert.equal(legacy.legacyJwtSecret.includes("dev-ai-platform-secret"), false);
});

test("production + legacy refuses startup", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    AI_PLATFORM_AUTH_MODE: process.env.AI_PLATFORM_AUTH_MODE,
    AI_PLATFORM_LEGACY_JWT_SECRET: process.env.AI_PLATFORM_LEGACY_JWT_SECRET,
    AI_PLATFORM_OIDC_ISSUER: process.env.AI_PLATFORM_OIDC_ISSUER,
    AI_PLATFORM_OIDC_AUDIENCE: process.env.AI_PLATFORM_OIDC_AUDIENCE,
    AI_PLATFORM_JWKS_URI: process.env.AI_PLATFORM_JWKS_URI,
    AI_PLATFORM_DATABASE_URL: process.env.AI_PLATFORM_DATABASE_URL,
  };
  process.env.NODE_ENV = "production";
  process.env.AI_PLATFORM_AUTH_MODE = "legacy";
  process.env.AI_PLATFORM_LEGACY_JWT_SECRET = "explicit-secret-0123456789";
  delete process.env.AI_PLATFORM_OIDC_ISSUER;
  delete process.env.AI_PLATFORM_OIDC_AUDIENCE;
  delete process.env.AI_PLATFORM_JWKS_URI;
  process.env.AI_PLATFORM_DATABASE_URL = "postgres://127.0.0.1:1/none";
  try {
    const { NestFactory } = await import("@nestjs/core");
    const { FastifyAdapter } = await import("@nestjs/platform-fastify");
    const { AppModule } = await import("../dist/app.module.js");
    await assert.rejects(
      () =>
        NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), {
          logger: false,
          abortOnError: false,
        }),
      (error) => /legacy is not allowed when NODE_ENV=production/.test(String(error?.message ?? error)),
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

function context(req) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  };
}
