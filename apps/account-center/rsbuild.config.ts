import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIdpDevProxyMap } from "@luminaryworks/auth-dev-proxy";
import { defineConfig, loadEnv } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { registerCodeCooldownMiddleware } from "../../services/auth-gateway/src/register-abuse.mjs";
import {
  buildHealthPayload,
  buildRuntimeConfig,
  buildVersionPayload,
  evaluateReadiness,
} from "./server/config.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const mode =
  process.env.NODE_ENV === "production" ? "production" : "development";
const { parsed } = loadEnv({
  cwd: root,
  mode,
  prefixes: ["ACCOUNT_CENTER_", "PUBLIC_"],
});
const env: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env)
      .filter((entry): entry is [string, string] => entry[1] != null)
      .map(([key, value]) => [key, value]),
  ),
  ...parsed,
};

const spaOrigin = env.ACCOUNT_CENTER_PUBLIC_URL || "http://127.0.0.1:3060";
const aiBase = env.ACCOUNT_CENTER_AI_BASE_URL || "http://127.0.0.1:13100";
const entitlementBase =
  env.ACCOUNT_CENTER_ENTITLEMENT_BASE_URL || "http://127.0.0.1:3040";
const port = Number(env.ACCOUNT_CENTER_PORT || 3060);

const registerPolicyPath = resolve(
  root,
  "../../identity/register-email-policy.json",
);

function publicRegisterPolicy(): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(registerPolicyPath, "utf8")) as Record<
      string,
      unknown
    >;
    const out: Record<string, unknown> = { enabled: true };
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith("_") || key === "$schema") continue;
      out[key] = value;
    }
    return out;
  } catch {
    return {
      enabled: true,
      mode: "off",
      allowlist: [],
      blocklist: [],
      codeCooldownSec: 120,
    };
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function proxyPrefix(prefix: string, target: string) {
  const base = new URL(target);
  const lib = base.protocol === "https:" ? httpsRequest : httpRequest;
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? "";
    const path = url.split("?")[0] ?? "";
    if (path !== prefix && !path.startsWith(`${prefix}/`)) {
      next();
      return;
    }
    const dest = `${url.slice(prefix.length) || "/"}`;
    const headers = { ...req.headers, host: base.host };
    const proxied = lib(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port,
        method: req.method,
        path: dest,
        headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxied.on("error", () => {
      if (!res.headersSent) {
        sendJson(res, 502, {
          error: { code: "UPSTREAM_UNAVAILABLE", message: target },
        });
      }
    });
    req.pipe(proxied);
  };
}

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: "./src/main.tsx" },
  },
  resolve: {
    alias: {
      "@": resolve(root, "src"),
      react: resolve(root, "node_modules/react"),
      "react-dom": resolve(root, "node_modules/react-dom"),
      "@luminaryworks/auth-react/style.css": resolve(
        root,
        "../../shared/packages/auth-react/dist/style.css",
      ),
      "@luminaryworks/auth-react": resolve(
        root,
        "../../shared/packages/auth-react/dist/index.js",
      ),
      "@luminaryworks/ui/shell.css": resolve(
        root,
        "../../shared/packages/ui/shell.css",
      ),
      "@luminaryworks/ui$": resolve(
        root,
        "../../shared/packages/ui/dist/index.js",
      ),
      "@luminaryworks/ai-react$": resolve(
        root,
        "../../shared/packages/ai-react/dist/index.js",
      ),
    },
  },
  html: {
    template: "./index.html",
    title: "LuminaryWorks Account Center",
    favicon: resolve(root, "../../assets/logo.svg"),
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    historyApiFallback: true,
    setup: ({ server }) => {
      server.middlewares.use(
        registerCodeCooldownMiddleware({ cooldownSec: 120 }),
      );
      server.middlewares.use(proxyPrefix("/ai-api", aiBase));
      server.middlewares.use(proxyPrefix("/entitlement-api", entitlementBase));
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (path === "/config.json") {
          try {
            sendJson(res, 200, buildRuntimeConfig(env));
          } catch (err) {
            sendJson(res, 500, {
              error: {
                code: "CONFIG_INVALID",
                message: err instanceof Error ? err.message : String(err),
              },
            });
          }
          return;
        }
        if (path === "/health" || path === "/healthz") {
          sendJson(res, 200, buildHealthPayload());
          return;
        }
        if (path === "/version") {
          sendJson(res, 200, buildVersionPayload(env));
          return;
        }
        if (path === "/ready") {
          let configError = "";
          try {
            buildRuntimeConfig(env);
          } catch (err) {
            configError = err instanceof Error ? err.message : String(err);
          }
          const result = evaluateReadiness({
            distExists: true,
            configError,
          });
          sendJson(res, result.statusCode, result.payload);
          return;
        }
        if (path === "/api/register-policy") {
          sendJson(res, 200, publicRegisterPolicy());
          return;
        }
        next();
      });
    },
    proxy: {
      ...createIdpDevProxyMap({
        spaOrigin,
        spaOriginFromRequest: true,
      }),
    },
  },
  output: {
    distPath: { root: "dist" },
    cleanDistPath: true,
  },
});
