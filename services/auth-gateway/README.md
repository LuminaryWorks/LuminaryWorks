# Luminary Auth Gateway

Products authenticate against **this gateway**, not Logto / Auth0 / Keycloak / Cognito directly.

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

- Swap IdP by changing `UPSTREAM_ISSUER` only
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
# Prefer gateway (IdP-agnostic)
VITE_AUTH_GATEWAY_URL=http://localhost:3010
# or set issuer directly to the gateway:
# VITE_IDP_ISSUER=http://localhost:3010/oidc

# Still required: app client_id from identity/registered-apps.json
VITE_IDP_CLIENT_ID=<spa client id>
```

Backend:

```env
IDP_ISSUER=http://localhost:3010/oidc
# or keep pointing at Logto during local MVP; production should use gateway
```

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `AUTH_GATEWAY_PORT` | `3010` | Listen port |
| `AUTH_GATEWAY_PUBLIC_URL` | `http://localhost:3010` | Issuer host rewritten into discovery |
| `UPSTREAM_ISSUER` | `http://localhost:3001/oidc` | Real IdP issuer |

## Scope (MVP)

- Proxies OIDC discovery, authorize, token, JWKS, userinfo
- Rewrites `issuer` in discovery JSON to the gateway URL

Not yet: Experience API branding proxy, bot detection, per-product rate limits (planned).
