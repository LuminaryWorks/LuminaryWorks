# LuminaryWorks Account Center

End-user SPA for profile, subscriptions, the AI wallet, bring-your-own-key provider connections, and links to partner products.

This is the user-facing counterpart of the operator Control Console (`apps/control-console`, `:3050`). It does not manage passwords. Password, MFA, and sessions stay on the identity provider (Logto).

## Auth boundary

- OIDC PKCE SPA. **No client secret** and **no service key** in the browser or in `/config.json`.
- Token audience: `https://ai.luminaryworks.dev` (AI Platform). The browser sends that bearer token to AI Platform.
- Local callbacks: `http://localhost:3060/auth/callback` and `http://127.0.0.1:3060/auth/callback`.
- Login is clickwrap: the box starts unchecked and blocks password, register, and social sign-in until it is checked. The checkbox shows only **User Agreement** and **Privacy Policy** (two links → `/legal/terms` and `/legal/privacy`). Those pages include Account Center terms plus a link to the LuminaryWorks platform docs (`PUBLIC_LEGAL_PLATFORM_*`).

Runtime config is **`GET /config.json`** (Rsbuild in dev, Fastify in production). The SPA rebinds redirects to `window.location.origin`.

## Dev

```bash
cp .env.example .env   # fill ACCOUNT_CENTER_IDP_CLIENT_ID after registration
pnpm install
pnpm dev               # 127.0.0.1:3060
```

Toolchain: **Rsbuild** + **RsTest** + Biome.

From the LuminaryWorks root: `pnpm acc:dev`.

In dev, loopback AI Platform (`:13100`) and Entitlement (`:3040`) URLs are proxied as `/ai-api` and `/entitlement-api` so the browser stays on the SPA origin. A production build calls the absolute URLs from `/config.json` and needs CORS:

- `AI_PLATFORM_CORS_ORIGINS` must include the Account Center origin (`http://localhost:3060`, `http://127.0.0.1:3060`, and the public HTTPS origin).
- `ENTITLEMENT_CORS_ORIGINS` must include the same origins for catalog and entitlement reads.

Partner apps come from `ACCOUNT_CENTER_APPS_JSON` (`apps: [{code,name,url,description}]`). Include all six partners when enabling the launcher (DataLuminary, BlockyEdu, DoerFlow, VistaRemote, VistaCast, SyncroBrain). Each card states that it is an independent partner product.

## Identity registration (lead)

`identity/**` is not edited by this app. Add this SPA to `identity/apps.json`, then `pnpm id:register`, and copy the public client id into `ACCOUNT_CENTER_IDP_CLIENT_ID`.

```json
{
  "name": "LuminaryWorks Account Center",
  "type": "SPA",
  "redirectUris": [
    "http://localhost:3060/auth/callback",
    "http://127.0.0.1:3060/auth/callback"
  ],
  "postLogoutRedirectUris": [
    "http://localhost:3060/",
    "http://127.0.0.1:3060/"
  ]
}
```

Also grant the SPA the API resource the access token uses as `aud`:

```json
{
  "name": "LuminaryWorks AI Platform",
  "indicator": "https://ai.luminaryworks.dev"
}
```

Entitlement user reads (`GET /v1/entitlements`) expect audience `https://entitlement.luminaryworks.dev`. This SPA requests the AI Platform audience so wallet and BYOK calls succeed. Catalog `GET /v1/catalog/plans` is public. Entitlement snapshots can return 401 until a token that Entitlement accepts is available; the billing page says so and does not sign the user out.

## Pages

| Route | What it calls |
| --- | --- |
| `/` | Identity claims from the access token and id token. Account and security links go to the IdP. |
| `/billing` | `GET /v1/catalog/plans`, `GET /v1/entitlements?productCode=`. Orders, invoices, and refunds have no end-user list API. |
| `/wallet` | `GET /v1/me/wallet`, `GET /v1/me/grants`, `GET /v1/me/usage?limit=` |
| `/keys` | `GET/POST /v1/providers`, `PATCH/DELETE /v1/providers/:uid`, `POST /v1/providers/test`, `POST /v1/providers/models` |
| `/apps` | `apps` from `/config.json` |

Notification preferences are omitted. `services/notification` only exposes internal mail routes.

## Production

`pnpm build && node server/main.mjs` (or the Docker image). Endpoints: `/health`, `/ready`, `/version`, `/config.json`.

Compose fragment for the lead: `deploy.compose.snippet.yaml`. Build context is the repo root.
