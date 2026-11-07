import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { assertAiPlatformAuthConfig, type AiPlatformConfig } from "./config/ai-platform.config";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );
  const settings = app.get(ConfigService).getOrThrow<AiPlatformConfig>("aiPlatform");
  assertAiPlatformAuthConfig(settings);
  await app.listen(settings.port, "0.0.0.0");
  console.log(`LuminaryWorks AI Platform http://localhost:${settings.port}/v1/health`);
}

bootstrap();
