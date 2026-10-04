import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIdpDevProxyMap } from "@luminaryworks/auth-dev-proxy";
import { defineConfig, loadEnv } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { buildRuntimeConfig } from "./server/config.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const mode =
  process.env.NODE_ENV === "production" ? "production" : "development";
const { parsed } = loadEnv({
  cwd: root,
  mode,
  prefixes: ["CONTROL_CONSOLE_", "PUBLIC_"],
});
const env: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env)
      .filter((entry): entry is [string, string] => entry[1] != null)
      .map(([key, value]) => [key, value]),
  ),
  ...parsed,
};

const spaOrigin = env.CONTROL_CONSOLE_PUBLIC_URL || "http://127.0.0.1:3050";
const entitlementBase =
  env.CONTROL_CONSOLE_ENTITLEMENT_BASE_URL || "http://127.0.0.1:3040";
const port = Number(env.CONTROL_CONSOLE_PORT || 3050);

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
      mode: "allowlist",
      allowlist: [],
      blocklist: [],
    };
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendConfigJson(_req: IncomingMessage, res: ServerResponse): void {
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
}

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: "./src/main.tsx" },
  },
  resolve: {
    alias: {
      "@": resolve(root, "src"),
    },
  },
  html: {
    template: "./index.html",
    title: "LuminaryWorks Control Console",
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    historyApiFallback: true,
    // Register before built-in SPA fallback so /config.json is not rewritten to index.html.
    // See https://rsbuild.rs/config/server/setup
    setup: ({ server }) => {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (path === "/config.json") {
          sendConfigJson(req, res);
          return;
        }
        // Auth Gateway endpoint; local IdP has no Auth Gateway — serve Identity policy file.
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
      "/v1": {
        target: entitlementBase,
        changeOrigin: true,
      },
      "/ready": {
        target: entitlementBase,
        changeOrigin: true,
      },
      "/health": {
        target: entitlementBase,
        changeOrigin: true,
      },
      "/version": {
        target: entitlementBase,
        changeOrigin: true,
      },
    },
  },
  output: {
    distPath: {
      root: "dist",
    },
    cleanDistPath: true,
  },
});
