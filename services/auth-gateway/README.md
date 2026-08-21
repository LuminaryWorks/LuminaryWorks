# Luminary Auth Gateway

Products send OIDC traffic through **this gateway**, not directly to Logto / Auth0 /
Keycloak / Cognito. Discovery deliberately keeps the provider's upstream `issuer`:
JWT `iss` is an identity contract and must not be rewritten. Browser-reachable
discovery endpoints (`authorization_endpoint`, `token_endpoint`, `jwks_uri`, and
others on the upstream origin) point at the gateway.

```text
              Logto | Auth0 | Keycloak | Cognito
                         |
                Luminary Auth Gateway  (:3010)
                         |
          +--------------+--------------+
          |              |              |
      DataView       BlockyEdu      VistaRemote …
```

## Why

- Centralize provider transport changes in `UPSTREAM_ISSUER`; JWT-verifying clients still use the provider's canonical issuer
- Room for product branding, risk controls, and audit without forking each SPA
- Enterprise private deploy: point upstream at customer IdP or self-hosted Logto (SAML/OIDC/LDAP connectors stay at the IdP)

## Local

```bash
# Identity must already be up (pnpm id:up)
cd LuminaryWorks
pnpm auth:gateway
# → http://localhost:3010/oidc
```

Health: `GET http://localhost:3010/health`

## Product env

```env
# Browser transport / discovery
VITE_AUTH_GATEWAY_URL=http://localhost:3010
# Canonical issuer used for JWT `iss` validation
VITE_IDP_ISSUER=http://localhost:3001/oidc

# Still required: app client_id from identity/registered-apps.json
VITE_IDP_CLIENT_ID=<spa client id>
```

Backends keep the canonical upstream issuer for JWT validation. They may fetch
JWKS through the gateway when their integration supports a separate JWKS URL.

```env
IDP_ISSUER=http://localhost:3001/oidc
# Optional integration-specific override:
# IDP_JWKS_URI=http://localhost:3010/oidc/jwks
```

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `AUTH_GATEWAY_PORT` | `3010` | Listen port |
| `AUTH_GATEWAY_PUBLIC_URL` | `http://localhost:3010` | Public host used for reachable discovery endpoints |
| `UPSTREAM_ISSUER` | `http://localhost:3001/oidc` | Real IdP issuer |
| `AUTH_GATEWAY_DISCOVERY_PATHS` | derived from `UPSTREAM_ISSUER` | Comma-separated provider discovery paths when they differ from standard OIDC |
| `AUTH_GATEWAY_CORS_ORIGINS` | local product origins | Comma-separated allowed browser origins |

For a provider whose issuer is `https://id.example.com/realms/acme`, the default
discovery paths include `/realms/acme` and
`/realms/acme/.well-known/openid-configuration`. Override
`AUTH_GATEWAY_DISCOVERY_PATHS` for a provider-specific layout. Other paths are
proxied transparently, so hosted login and provider APIs do not require hard-coded
Logto routes in the gateway.

## Scope (MVP)

- Proxies OIDC discovery, authorize, token, JWKS, userinfo
- Keeps discovery `issuer` on the upstream provider so JWT verification matches `iss`
- Rewrites reachable discovery endpoints, redirects, and cookie scope to the gateway
- Proxies Logto **Experience API** at `{gateway}/api/experience/*` (Headless password / MFA UI in product SPAs)
- CORS for local product origins (`AUTH_GATEWAY_CORS_ORIGINS`)

Product Headless clients should set `VITE_AUTH_GATEWAY_URL` (Experience base is derived automatically) or `VITE_AUTH_EXPERIENCE_URL`.

Still planned: per-product branding injection, bot detection, rate limits.
