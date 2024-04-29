import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Request, type NextFunction, type Response } from "express";
import { AppModule } from "./app.module";
import { REQUEST_RAW_BODY_KEY } from "./auth/auth.types";
import type { EntitlementConfig } from "./config/entitlement.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
    rawBody: true,
  });

  // Preserve raw body on request for partner webhook HMAC verification
  app.use(
    (
      req: Request & { [REQUEST_RAW_BODY_KEY]?: Buffer; rawBody?: Buffer },
      _res: Response,
      next: NextFunction,
    ) => {
      if (req.rawBody) {
        req[REQUEST_RAW_BODY_KEY] = req.rawBody;
      }
      next();
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
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Entitlement service listening on :${port} (OpenAPI /docs)`);
}

bootstrap();
