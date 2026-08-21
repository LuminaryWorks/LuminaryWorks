---
name: product-auth-implementation
description: >-
  Implements LuminaryWorks product login (IAM Adapter + OIDC / Logto Experience)
  and resource authorization (Casbin) for NestJS + React SPAs. Use when wiring
  unified login, OIDC, JWT guards, Casbin ACL, permissions JSON on resources,
  or when the user asks to integrate Logto/Casbin into a product repo.
---

# Product Auth Implementation (Luminary IAM Adapter + Casbin)

Follow MetaRepo spec: `LuminaryWorks/spec/identity-and-permissions.md`.

## Non-negotiables

1. **AuthN = Luminary IAM Adapter.** Logto is the current default provider; enterprise/private deployments may use standard external OIDC. Do not invent product-local password stores for production OIDC modes.
2. **AuthZ = product Casbin.** Never put dashboard/device/course ACL into JWT or IdP roles.
3. **Login UI = Login Experience Adapter + OIDC PKCE.** Logto uses Experience API Headless; providers without Headless APIs use Hosted Redirect. Do not fork IdP login source as the default path.
4. **Management API is central-only.** Never put M2M credentials or an Identity Management client in a product backend or browser.
5. Use shared packages when available:
   - Backend: `@luminaryworks/auth-core` (JWKS verify + `LuminaryJwtAuthGuard`)
   - Frontend: `@luminaryworks/auth-react` (OIDC PKCE + `HeadlessLoginPanel`)
   - Dev proxy: `@luminaryworks/auth-dev-proxy` (same-origin `/oidc` + `/api/experience`)
   - Optional: `@luminaryworks/pal` as abstraction over Casbin adapter
6. Map external identity key `issuer + sub` → local `user_id` on first authenticated request (upsert). Existing `logtoSub` columns are compatibility names, not globally unique identities.
7. List/detail APIs return `permissions: { view, edit, delete, ... }` computed by Casbin.

## Preconditions

- Local IdP: `cd LuminaryWorks && pnpm id:up` → OIDC `http://localhost:3001/oidc`, Admin `:3002`
- App registered in `identity/apps.json` + `node scripts/register-apps.mjs`
- Product `.env` has `IDP_ISSUER`, `IDP_AUDIENCE`, and SPA `VITE_IDP_*`

## Implementation checklist

### A. Backend (NestJS + Fastify)

1. HTTP adapter: **`@nestjs/platform-fastify` only** — never `@nestjs/platform-express` / Express.
2. Add deps: `@luminaryworks/auth-core`, `casbin`, adapter (e.g. `typeorm-adapter` or file adapter for MVP).
3. Register `LuminaryAuthModule` + global `LuminaryJwtAuthGuard`; consume normalized `LuminaryPrincipal` instead of provider-specific claims.
4. Add `CasbinModule` / `PermissionService`:
   - Model: request `sub, obj, act`; policy `p, sub, obj, act`; optional `g, _, _` for RBAC.
   - `enforce(userKey, resourceKey, action)` and `batchPermissions(userKey, resourceKey, actions[])`.
5. Replace ad-hoc RBAC checks gradually: controllers keep `@RequirePermission`; implementation delegates to Casbin.
6. Webhook (optional P2): IAM Provider user disable → clear local cache / disable user.

Env:

```bash
IDP_ISSUER=http://localhost:3001/oidc
IDP_AUDIENCE=https://api.<product>.local
IDP_MODE=logto
```

### B. Frontend (React SPA)

1. Use `@luminaryworks/auth-react`: `HeadlessLoginPanel` + the configured `LoginExperienceAdapter` (default Logto) + `readIdpConfigFromEnv` / product `lib/idp.ts` with **static** `import.meta.env.KEY` / `process.env.NEXT_PUBLIC_*` reads (bundlers do not inline dynamic env maps).
2. **Login UI = product-branded adapter UI.** Logto defaults to Headless; providers without a supported Headless adapter use Hosted Redirect. Local product passwords stay behind `VITE_ALLOW_LOCAL_LOGIN` / `NEXT_PUBLIC_ALLOW_LOCAL_LOGIN` (dev). Production: `false`.
3. **Social connectors:** default `showSocialConnectors={true}` (loads Google/GitHub/… from IdP). For **admin / internal consoles**, set **`showSocialConnectors={false}`** (or `socialProviders={[]}`) so Experience social buttons are not fetched or shown. End-user product login keeps social on unless product policy says otherwise. Enterprise SSO stays on the IdP — this prop only hides social connector UI.
4. Routes: path `/auth/callback` (history fallback) even if the app uses HashRouter — mount callback before the hash router when `pathname === /auth/callback`.
5. **Same-origin IdP proxy (local default):** `@luminaryworks/auth-dev-proxy`
   - Rsbuild/Vite: `createIdpDevProxyMap({ spaOrigin })` for `/oidc` + `/api/experience` **before** backend `/api` proxy.
   - Next.js: `forwardIdpFetch` route handlers at `app/oidc/[...path]` and `app/api/experience/[[...path]]` (so Experience is not swallowed by API rewrites).
   - Set `VITE_AUTH_EXPERIENCE_URL` / `PUBLIC_AUTH_EXPERIENCE_URL` / `NEXT_PUBLIC_AUTH_EXPERIENCE_URL` to the **SPA origin** (not `:3010`).
   - Keep `VITE_IDP_ISSUER=http://localhost:3001/oidc` so JWT `iss` matches Logto.
   - Auth Gateway (`:3010`) is optional locally; preferred in multi-product / production.
6. Attach `Authorization: Bearer <access_token>` to API client; exchange via product `POST …/auth/sso/login` when the API still issues a local session JWT.
7. Drive UI from resource `permissions` fields — do not hardcode role names for buttons.
8. Brand the login page per product (logo, colors, copy). Auth logic stays SDK/API.
9. Optional return-path helpers: `createPostLoginPathHelpers({ storageKey, defaultPath })` from `@luminaryworks/auth-react`.

Env:

```bash
# Same-origin Experience (dev) — required for Headless without Auth Gateway
VITE_AUTH_EXPERIENCE_URL=http://localhost:<spa-port>
# Optional: AUTH_IDP_PROXY_TARGET=http://localhost:3001
# Optional multi-product: VITE_AUTH_GATEWAY_URL=http://localhost:3010
VITE_IDP_ISSUER=http://localhost:3001/oidc
VITE_IDP_CLIENT_ID=<from identity/registered-apps.json>
VITE_IDP_REDIRECT_URI=http://localhost:<spa-port>/auth/callback
VITE_ALLOW_LOCAL_LOGIN=false
```

Private / enterprise: point Gateway `UPSTREAM_ISSUER` (or product issuer) at customer IdP / self-hosted Logto and select a supported runtime/login adapter; connectors (SAML/LDAP/OIDC) stay at the IdP. Do not add empty adapters for unintegrated providers.
### C. Casbin model (starter)

```ini
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && (r.obj == p.obj || p.obj == "*") && (r.act == p.act || p.act == "*")
```

Resource keys: `<type>:<id>` e.g. `dashboard:100`, `space:16`, `course:9`.  
Actions: `view|create|edit|delete|export|import|download|share` (product may subset).

### D. Permissions JSON shape

Match existing product contracts when present:

```json
{
  "id": 100,
  "name": "…",
  "permission": {
    "view": true,
    "edit": true,
    "delete": false,
    "export": true,
    "share": true
  }
}
```

(List items may use `permissions` plural — keep product-consistent.)

### E. Product-specific namespaces

| Product | Prefix / domain | Typical objects |
|---------|-----------------|-----------------|
| DataLuminary | `dashboard`, `space`, `dataset`, `datasource` | BI resources |
| BlockyEdu | `edu` | course, class, assignment |
| DoerFlow | `agent` | strategy, task, audit |
| VistaCast | `cast` | camera, alert, stream |
| VistaRemote | `remote` | device, session, file |
| SyncroBrain | `iot` | device, rule, telemetry |

### F. Out of scope / do not

- Do not store business ACL in IdP custom claims.
- Do not call any IdP Management API from SPA or product services; central `identity` owns those credentials.
- Do not break offline `IDP_MODE=legacy` until OIDC path is verified (feature-flag if needed).
- Do not cross-import other products' permission tables.

## Done criteria

- [ ] Unauthenticated API → 401; invalid JWT → 401
- [ ] Valid JWT without Casbin policy → deny protected actions
- [ ] Resource GET returns computed `permission(s)` map
- [ ] Login + callback works through the configured Login Experience Adapter
- [ ] README / product `spec` mentions Luminary IAM Adapter + Casbin and links MetaRepo IAM spec
- [ ] `.env.example` documents `IDP_*` / `VITE_IDP_*`

## References

- MetaRepo: `spec/identity-and-permissions.md`
- Docs: `docs/docs/develop/unified-login.md`
- Identity: `identity/README.md`, `identity/apps.json`
- Shared: `shared/packages/auth-core`, `auth-react`, `pal`
