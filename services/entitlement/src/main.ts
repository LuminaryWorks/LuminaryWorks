import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cors from "@fastify/cors";
import { AppModule } from "./app.module";
import { REQUEST_RAW_BODY_KEY } from "./auth/auth.types";
import { corsOriginOption } from "./common/cors";
import type { EntitlementConfig } from "./config/entitlement.config";

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: false,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: ["error", "warn", "log"],
    // Nest would register application/json during init; we replace that parser
    // so partner webhook HMAC can read the raw buffer. Express `rawBody: true` is forbidden.
    bodyParser: false,
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body: Buffer, done) => {
      try {
        const request = req as typeof req & { [REQUEST_RAW_BODY_KEY]?: Buffer };
        request[REQUEST_RAW_BODY_KEY] = body;
        const text = body.toString("utf8");
        done(null, text.length > 0 ? JSON.parse(text) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
  fastify.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "buffer" },
    (req, body: Buffer, done) => {
      const request = req as typeof req & { [REQUEST_RAW_BODY_KEY]?: Buffer };
      request[REQUEST_RAW_BODY_KEY] = body;
      done(null, Object.fromEntries(new URLSearchParams(body.toString("utf8"))));
    },
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle("LuminaryWorks Entitlement API")
    .setDescription(
      "Central subscription & entitlement control plane. Commercial rights are never embedded in JWT. License never bypasses Casbin.",
    )
    .setVersion("0.2.0")
    .addBearerAuth()
    .addApiKey({ type: "apiKey", name: "x-service-key", in: "header" }, "service-key")
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup("docs", app, document);

  const config = app.get(ConfigService);
  const entitlement = config.getOrThrow<EntitlementConfig>("entitlement");
  await app.register(cors, {
    origin: corsOriginOption(entitlement.corsOrigins),
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id", "X-Act-As-Subject"],
  });
  const port = entitlement.port;
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`Entitlement service listening on :${port} (OpenAPI /docs)`);
}

bootstrap();
