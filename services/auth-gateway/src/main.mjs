/**
 * Luminary Auth Gateway — OIDC + Experience API reverse proxy in front of the active IdP.
 *
 * Products point VITE_IDP_ISSUER / IDP_ISSUER at this gateway (`…/oidc`),
 * not at Logto/Auth0/Keycloak directly. Swap UPSTREAM_ISSUER to change IdP
 * without touching product code.
 *
 * Local:  pnpm --dir services/auth-gateway start
 * Default listen: http://localhost:3010  → upstream Logto http://localhost:3001
 *
 * For product-origin Headless (cookies on the SPA host), products should also
 * same-origin proxy `/oidc` + `/api/experience` (+ `/sign-in`) to this gateway
 * and rewrite discovery `issuer` to the SPA origin.
 */
import http from "node:http";
import { URL } from "node:url";
import zlib from "node:zlib";

const PORT = Number(process.env.AUTH_GATEWAY_PORT || 3010);
const PUBLIC_BASE = (process.env.AUTH_GATEWAY_PUBLIC_URL || `http://localhost:${PORT}`).replace(
  /\/$/,
  "",
);
const UPSTREAM = (process.env.UPSTREAM_ISSUER || "http://localhost:3001/oidc").replace(/\/$/, "");
const UPSTREAM_ORIGIN = new URL(UPSTREAM).origin;
const CORS_ORIGINS = (process.env.AUTH_GATEWAY_CORS_ORIGINS ||
  [
    "http://localhost:3003",
    "http://127.0.0.1:3003",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5180",
    "http://localhost:13010",
    "http://localhost:13011",
    "http://localhost:18081",
    "http://localhost:18082",
  ].join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function gatewayIssuer() {
  return `${PUBLIC_BASE}/oidc`;
}

/**
 * Keep upstream `issuer` (JWT `iss` must match Logto) but point all endpoints at the
 * gateway so browser SPA calls stay CORS-friendly.
 */
function rewriteDiscovery(body) {
  try {
    const data = JSON.parse(body);
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== "string") continue;
      if (key === "issuer") continue;
      if (value.startsWith(UPSTREAM_ORIGIN)) {
        data[key] = value.replace(UPSTREAM_ORIGIN, PUBLIC_BASE);
      } else if (value.startsWith(UPSTREAM)) {
        data[key] = value.replace(UPSTREAM, gatewayIssuer());
      }
    }
    return JSON.stringify(data);
  } catch {
    return body
      .replaceAll(`${UPSTREAM_ORIGIN}/oidc/`, `${PUBLIC_BASE}/oidc/`)
      .replaceAll(UPSTREAM_ORIGIN, PUBLIC_BASE);
  }
}

function rewriteLocation(location) {
  if (!location) return location;
  return location.replaceAll(UPSTREAM_ORIGIN, PUBLIC_BASE);
}

function rewriteSetCookie(cookie) {
  // Bind cookie to the gateway host the browser actually talks to (drop Domain).
  return cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !/^domain=/i.test(part))
    .join("; ");
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("vary", "Origin");
    res.setHeader(
      "access-control-allow-headers",
      req.headers["access-control-request-headers"] || "content-type, authorization, accept",
    );
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  }
}

function proxyToUpstream(req, res, upstreamPathWithSearch) {
  const target = new URL(upstreamPathWithSearch, UPSTREAM_ORIGIN);
  const headers = { ...req.headers };
  delete headers.host;
  // Buffering proxy cannot safely forward compressed bodies — ask for identity encoding.
  delete headers["accept-encoding"];
  headers.host = new URL(UPSTREAM_ORIGIN).host;

  const upstreamReq = http.request(target, { method: req.method, headers }, (upstreamRes) => {
    const chunks = [];
    upstreamRes.on("data", (c) => chunks.push(c));
    upstreamRes.on("end", () => {
      let buf = Buffer.concat(chunks);
      const ct = String(upstreamRes.headers["content-type"] || "");
      const encoding = String(upstreamRes.headers["content-encoding"] || "").toLowerCase();
      const isDiscovery =
        target.pathname.includes("/.well-known/openid-configuration") ||
        target.pathname.endsWith("/oidc");

      // If upstream still compressed (some stacks ignore accept-encoding), decompress first.
      if (encoding.includes("gzip")) {
        try {
          buf = zlib.gunzipSync(buf);
        } catch {
          /* keep original */
        }
      } else if (encoding.includes("deflate")) {
        try {
          buf = zlib.inflateSync(buf);
        } catch {
          try {
            buf = zlib.inflateRawSync(buf);
          } catch {
            /* keep original */
          }
        }
      } else if (encoding.includes("br")) {
        try {
          buf = zlib.brotliDecompressSync(buf);
        } catch {
          /* keep original */
        }
      }

      if (ct.includes("json") || isDiscovery) {
        try {
          const text = rewriteDiscovery(buf.toString("utf8"));
          buf = Buffer.from(text, "utf8");
        } catch {
          /* keep original */
        }
      }

      applyCors(req, res);

      const setCookies = upstreamRes.headers["set-cookie"];
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (
          key === "transfer-encoding" ||
          key === "content-length" ||
          key === "content-encoding" ||
          key === "set-cookie"
        ) {
          continue;
        }
        // Strip IdP isolation headers that block SPA cross-origin reads via the gateway.
        if (
          key === "cross-origin-resource-policy" ||
          key === "cross-origin-embedder-policy" ||
          key === "cross-origin-opener-policy" ||
          key === "x-frame-options"
        ) {
          continue;
        }
        if (key === "location" && typeof value === "string") {
          res.setHeader("location", rewriteLocation(value));
          continue;
        }
        if (value !== undefined) res.setHeader(key, value);
      }
      if (setCookies) {
        const list = Array.isArray(setCookies) ? setCookies : [setCookies];
        res.setHeader(
          "set-cookie",
          list.map((c) => rewriteSetCookie(c)),
        );
      }
      res.setHeader("content-length", String(buf.length));
      res.writeHead(upstreamRes.statusCode || 502);
      res.end(buf);
    });
  });

  upstreamReq.on("error", (err) => {
    applyCors(req, res);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_gateway", message: String(err.message), upstream: UPSTREAM }));
  });

  req.pipe(upstreamReq);
}

function proxy(req, res) {
  const incoming = new URL(req.url || "/", PUBLIC_BASE);

  if (req.method === "OPTIONS") {
    applyCors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (incoming.pathname === "/health" || incoming.pathname === "/healthz") {
    applyCors(req, res);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, issuer: gatewayIssuer(), upstream: UPSTREAM }));
    return;
  }

  // Full reverse proxy so authorize → /sign-in stays on the gateway host (cookies).
  proxyToUpstream(req, res, incoming.pathname + incoming.search);
}

const server = http.createServer(proxy);
server.listen(PORT, () => {
  console.log(`[auth-gateway] listening on ${PUBLIC_BASE}`);
  console.log(`[auth-gateway] public issuer: ${gatewayIssuer()}`);
  console.log(`[auth-gateway] experience:   ${PUBLIC_BASE}/api/experience`);
  console.log(`[auth-gateway] upstream:      ${UPSTREAM}`);
});
