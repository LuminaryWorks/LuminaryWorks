import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";
import { GatewayFilter } from "./gateway.filter";

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: config.trustProxy }),
    { logger: ["error", "warn", "log"] },
  );
  app.useGlobalFilters(new GatewayFilter());
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", (req, reply, done) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "authorization, content-type");
    reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      void reply.code(204).send();
      return;
    }
    done();
  });
  await app.listen(config.port, "0.0.0.0");
  console.log(`media-gateway listening on :${config.port}`);
}

void bootstrap();
