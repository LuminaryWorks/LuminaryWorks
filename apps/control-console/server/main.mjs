import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import {
  buildHealthPayload,
  buildRuntimeConfig,
  buildVersionPayload,
  evaluateReadiness,
} from "./config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");

export function createServer(env = process.env) {
  const app = Fastify({ logger: false });
  const port = Number(env.CONTROL_CONSOLE_PORT || 3050);

  app.get("/health", async () => buildHealthPayload());
  app.get("/healthz", async () => buildHealthPayload());
  app.get("/version", async () => buildVersionPayload(env));

  app.get("/ready", async (_req, reply) => {
    let configError = "";
    try {
      buildRuntimeConfig(env);
    } catch (err) {
      configError = err instanceof Error ? err.message : String(err);
    }
    const result = evaluateReadiness({
      distExists: existsSync(join(distDir, "index.html")),
      configError,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get("/config.json", async (_req, reply) => {
    try {
      return buildRuntimeConfig(env);
    } catch (err) {
      reply.code(500);
      return {
        error: {
          code: "CONFIG_INVALID",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  });

  if (existsSync(distDir)) {
    app.register(fastifyStatic, {
      root: distDir,
      prefix: "/",
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split("?")[0];
      if (
        url.startsWith("/health") ||
        url.startsWith("/ready") ||
        url.startsWith("/version") ||
        url.startsWith("/config.json")
      ) {
        reply.code(404);
        return reply.send({ error: { code: "NOT_FOUND", message: url } });
      }
      return reply.sendFile("index.html");
    });
  }

  return { app, port };
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { app, port } = createServer();
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Control Console listening on :${port}`);
}
