/**
 * Luminary Auth Gateway — OIDC reverse proxy in front of the active IdP.
 *
 * Products point VITE_IDP_ISSUER / IDP_ISSUER at this gateway (`…/oidc`),
 * not at Logto/Auth0/Keycloak directly. Swap UPSTREAM_ISSUER to change IdP
 * without touching product code.
 *
 * Local:  pnpm --dir services/auth-gateway start
 * Default listen: http://localhost:3010  → upstream Logto http://localhost:3001
 */
import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.AUTH_GATEWAY_PORT || 3010);
const PUBLIC_BASE = (process.env.AUTH_GATEWAY_PUBLIC_URL || `http://localhost:${PORT}`).replace(
  /\/$/,
  "",
);
const UPSTREAM = (process.env.UPSTREAM_ISSUER || "http://localhost:3001/oidc").replace(/\/$/, "");
const UPSTREAM_ORIGIN = new URL(UPSTREAM).origin;

function gatewayIssuer(): string {
  return `${PUBLIC_BASE}/oidc`;
}

function rewriteDiscovery(body: string): string {
  const upstreamIssuer = UPSTREAM;
  const gw = gatewayIssuer();
  // Rewrite issuer and absolute endpoint URLs that point at the upstream host.
  return body
    .replaceAll(upstreamIssuer, gw)
    .replaceAll(`${UPSTREAM_ORIGIN}/oidc`, gw)
    .replaceAll(UPSTREAM_ORIGIN, PUBLIC_BASE);
}

function proxy(req: http.IncomingMessage, res: http.ServerResponse): void {
  const incoming = new URL(req.url || "/", PUBLIC_BASE);

  // Health
  if (incoming.pathname === "/health" || incoming.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, issuer: gatewayIssuer(), upstream: UPSTREAM }));
    return;
  }

  // Map /oidc/* → upstream /oidc/*
  let upstreamPath = incoming.pathname;
  if (upstreamPath === "/oidc") upstreamPath = "/oidc";
  if (!upstreamPath.startsWith("/oidc")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found", hint: "Use {gateway}/oidc as OIDC issuer" }));
    return;
  }

  const target = new URL(upstreamPath + incoming.search, UPSTREAM_ORIGIN);
  const headers: Record<string, string | string[] | undefined> = { ...req.headers };
  delete headers.host;
  headers.host = new URL(UPSTREAM_ORIGIN).host;

  const upstreamReq = http.request(
    target,
    { method: req.method, headers },
    (upstreamRes) => {
      const chunks: Buffer[] = [];
      upstreamRes.on("data", (c) => chunks.push(c));
      upstreamRes.on("end", () => {
        let buf = Buffer.concat(chunks);
        const ct = String(upstreamRes.headers["content-type"] || "");
        const isDiscovery =
          target.pathname.includes("/.well-known/openid-configuration") ||
          target.pathname.endsWith("/oidc");

        if (ct.includes("json") || isDiscovery) {
          try {
            const text = rewriteDiscovery(buf.toString("utf8"));
            buf = Buffer.from(text, "utf8");
            upstreamRes.headers["content-length"] = String(buf.length);
          } catch {
            /* keep original */
          }
        }

        // Drop hop-by-hop
        const outHeaders = { ...upstreamRes.headers };
        delete outHeaders["transfer-encoding"];
        res.writeHead(upstreamRes.statusCode || 502, outHeaders);
        res.end(buf);
      });
    },
  );

  upstreamReq.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_gateway", message: String(err.message), upstream: UPSTREAM }));
  });

  req.pipe(upstreamReq);
}

const server = http.createServer(proxy);
server.listen(PORT, () => {
  console.log(`[auth-gateway] listening on ${PUBLIC_BASE}`);
  console.log(`[auth-gateway] public issuer: ${gatewayIssuer()}`);
  console.log(`[auth-gateway] upstream:      ${UPSTREAM}`);
});
