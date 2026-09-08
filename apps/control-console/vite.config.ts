import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIdpDevProxyMap } from "@luminaryworks/auth-dev-proxy";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { buildRuntimeConfig } from "./server/config.mjs";

const root = dirname(fileURLToPath(import.meta.url));

function runtimeConfigPlugin(env: Record<string, string>): Plugin {
  const handler = (
    _req: unknown,
    res: {
      setHeader: (k: string, v: string) => void;
      end: (s: string) => void;
      statusCode: number;
    },
  ) => {
    try {
      const body = buildRuntimeConfig(env);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(body));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "CONFIG_INVALID",
            message: err instanceof Error ? err.message : String(err),
          },
        }),
      );
    }
  };
  return {
    name: "control-console-runtime-config",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/config.json") return next();
        handler(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/config.json") return next();
        handler(req, res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, root, "") };
  const spaOrigin = env.CONTROL_CONSOLE_PUBLIC_URL || "http://localhost:3050";
  return {
    plugins: [react(), runtimeConfigPlugin(env)],
    resolve: {
      alias: {
        "@": resolve(root, "src"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: Number(env.CONTROL_CONSOLE_PORT || 3050),
      proxy: {
        ...createIdpDevProxyMap({ spaOrigin }),
        "/v1": {
          target:
            env.CONTROL_CONSOLE_ENTITLEMENT_BASE_URL || "http://127.0.0.1:3040",
          changeOrigin: true,
        },
        "/ready": {
          target:
            env.CONTROL_CONSOLE_ENTITLEMENT_BASE_URL || "http://127.0.0.1:3040",
          changeOrigin: true,
        },
        "/health": {
          target:
            env.CONTROL_CONSOLE_ENTITLEMENT_BASE_URL || "http://127.0.0.1:3040",
          changeOrigin: true,
        },
        "/version": {
          target:
            env.CONTROL_CONSOLE_ENTITLEMENT_BASE_URL || "http://127.0.0.1:3040",
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: Number(env.CONTROL_CONSOLE_PORT || 3050),
    },
  };
});
