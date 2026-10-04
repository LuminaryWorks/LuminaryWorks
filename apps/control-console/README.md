# LuminaryWorks Control Console

Standalone **business** superadmin SPA for Entitlement (catalog, payments, trial cleanup, legal, capacity).

This is **not** the Logto Admin Console (`IDENTITY_ADMIN_PORT`, typically `:3002`). Logto Admin manages the IdP. This console calls Entitlement `/v1/admin/*` with an operator access token.

## Auth boundary (live)

- OIDC PKCE SPA. **No client secret** and **no Entitlement service key** in the browser or in `/config.json`.
- Register `LuminaryWorks Control Console` in `identity/apps.json`, then `pnpm id:register`. Copy the public `client_id` into `CONTROL_CONSOLE_IDP_CLIENT_ID`.
- Token audience: `https://entitlement.luminaryworks.dev` (Entitlement API resource). Required scope: `entitlement:admin` (assign the scope to the operator in Logto; this SPA cannot mint it).
- Local callbacks: `http://localhost:3050/auth/callback` and `http://127.0.0.1:3050/auth/callback`. Production: add the public HTTPS origin in Logto (do not commit secrets). Social connectors are disabled in the login panel.
- 401 → re-auth. 402 (commercial entitlement) is shown separately from 403 (missing admin scope / forbidden).

Runtime config is served from **`GET /config.json`** (Rsbuild middleware in dev, Fastify in production). Rebuild is not required to change issuer, client id, or Entitlement URL. The SPA always rebinds redirects / Experience API to `window.location.origin` so `localhost` and `127.0.0.1` both work.

## Dev

```bash
cp .env.example .env   # fill CONTROL_CONSOLE_IDP_CLIENT_ID
pnpm install
pnpm dev               # 127.0.0.1:3050
```

Toolchain: **Rsbuild** + **RsTest** + Biome（与生态前端一致；非 Vite）。

Login: platform `superadmin` from `identity/ACCOUNTS.dev.env` (not Logto Admin `:3002`). Use the language switcher on the login page (en / zh).

Same-origin IdP proxy (`@luminaryworks/auth-dev-proxy`, `spaOriginFromRequest`) is enabled for Headless login. Entitlement CORS must allow the console origin, or use the Rsbuild `/v1` proxy. Start Entitlement (`pnpm ent:dev`) for catalog / providers APIs.
## Production

`pnpm build && node server/main.mjs` (or the Docker image). Endpoints: `/health`, `/ready`, `/version`, `/config.json`.
