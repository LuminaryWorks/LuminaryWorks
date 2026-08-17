import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { REQUEST_RAW_BODY_KEY } from "./auth/auth.types";
import type { EntitlementConfig } from "./config/entitlement.config";

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: false,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: ["error", "warn", "log"],
  });

  // Preserve raw body for partner webhook HMAC verification (Nest Express rawBody is Express-only).
  const fastify = app.getHttpAdapter().getInstance();
  fastify.removeContentTypeParser("application/json");
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
  const port = config.getOrThrow<EntitlementConfig>("entitlement").port;
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`Entitlement service listening on :${port} (OpenAPI /docs)`);
}

bootstrap();
