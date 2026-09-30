import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import type { NotificationConfig } from "./config/notification.config";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), {
    logger: ["error", "warn", "log"],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: false,
      forbidUnknownValues: false,
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle("LuminaryWorks Notification API")
    .setDescription("Auth mail delivery for Logto. Products do not choose the email provider.")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swagger));

  const settings = app.get(ConfigService).getOrThrow<NotificationConfig>("notification");
  if (settings.serviceKey.length < 16) {
    throw new Error("NOTIFICATION_SERVICE_KEY must be at least 16 characters");
  }
  if (settings.secretKey.length < 16) {
    throw new Error("NOTIFICATION_SECRET_KEY must be at least 16 characters");
  }

  await app.listen(settings.port, "0.0.0.0");
  console.log(`Notification service listening on :${settings.port} (OpenAPI /docs)`);
}

bootstrap();
