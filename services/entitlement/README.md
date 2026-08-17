# LuminaryWorks Entitlement Service

Central subscription / entitlement control plane (NestJS + Fastify + PostgreSQL).

Authoritative contract: [`spec/subscription-and-entitlement.md`](../../spec/subscription-and-entitlement.md).

## Local quickstart

```bash
# from MetaRepo root
pnpm ent:up          # postgres (+ optional app container)
pnpm ent:migrate     # TypeORM migrations
pnpm ent:seed        # catalog seed (trial/pro/ultra/enterprise)
pnpm ent:dev         # nest start --watch on :3040
```

Or inside this directory:

```bash
cp env.example .env   # gitignored; do not commit secrets
docker compose up -d entitlement-db
pnpm install
pnpm migration:run
pnpm seed
pnpm start:dev
```

Schema changes: prefer `pnpm migration:run`. Set `ENTITLEMENT_SYNCHRONIZE=true` only for throwaway local DBs. Compose sets `ENTITLEMENT_MIGRATIONS_RUN=true`, which keeps synchronize off.
- Health: `GET /health` · Ready: `GET /ready`
- OpenAPI: `http://localhost:3040/docs`

## Auth

| Mode | Env | Behavior |
|------|-----|----------|
| `legacy` (dev) | `ENTITLEMENT_AUTH_MODE=legacy` | HS256 JWT with `ENTITLEMENT_LEGACY_JWT_SECRET` |
| `oidc` | issuer + audience | JWKS verify Logto / OIDC access tokens |
| Service | `X-Service-Key: $ENTITLEMENT_SERVICE_API_KEY` | Internal/admin; scopes include `entitlement:admin` |
| Partner M2M | `POST /v1/oauth/token` (`client_credentials`) | Returns `partner+jwt` Bearer; scoped `partner:*` |

**Subject identity** for user APIs always comes from verified `sub` (or service subject header for M2M). Request-body `subjectId` is never trusted for USER grants.

Admin routes (`/v1/admin/*`) require admin scope or service credential. Partner routes require partner token scopes. **Commercial entitlements never enter JWT.**

Service API keys and webhook signatures use **constant-time** comparison (`timingSafeEqual` / length-safe helpers).

## Core APIs

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/entitlements` | Effective snapshot |
| POST | `/v1/entitlements/check` | Batch feature/quota check |
| POST | `/v1/entitlements/consume` | Atomic quota consume (+ Idempotency-Key) |
| POST | `/v1/trials/ensure` | One-time 7-day ToC trial per user+product |
| GET | `/v1/catalog/plans` | Plan catalog |
| GET | `/v1/catalog/features` | Feature definitions |
| POST | `/v1/orders` | Create order |
| POST | `/v1/orders/:id/pay` | Payment adapter entry |
| POST | `/v1/admin/grants` | Manual/contract grant |

## Partner protocol (generic joint membership)

No partner brand names are hardcoded. Register partners via admin; partners authenticate with OAuth2 **client_credentials**.

| Method | Path | Auth |
|--------|------|------|
| POST | `/v1/admin/partners` | Admin — register + one-time credentials |
| POST | `/v1/admin/partners/:id/rotate-credentials` | Admin |
| POST | `/v1/admin/partners/:id/benefits` | Admin — benefit templates |
| POST | `/v1/oauth/token` | Public — `grant_type=client_credentials` |
| POST | `/v1/partner/redemptions` | `partner:redeem` — idempotent |
| POST | `/v1/partner/redemptions/:id/revoke` | `partner:revoke` |
| GET | `/v1/partner/redemptions` | `partner:reconcile` — time-window listing |
| POST | `/v1/partner/callbacks/:partnerCode` | Public — HMAC + timestamp + nonce |

Inbound callbacks: HMAC-SHA256 over `` `${timestamp}.${nonce}.${rawBody}` ``, header `x-lw-signature: v1=<base64url>`, replay window via `ENTITLEMENT_PARTNER_REPLAY_WINDOW_SECONDS`, nonce stored in `partner_nonces`. Outbound partner webhooks use the same scheme and are delivered through the transactional outbox.

## Ed25519 private-deployment License

License grants map to `DEPLOYMENT` subject grants only. **Never bypasses Casbin** resource ACL.

```bash
pnpm license:gen-keys --out ./license-keys   # writes private.pem (gitignored locally), public ring
pnpm license:issue --key ./license-keys/private.pem --kid <kid> --in payload.json --out license.json
pnpm license:verify --pub-ring ./license-keys/ring.json --in license.json
```

- Public keys: `ENTITLEMENT_LICENSE_PUBLIC_KEYS` (JSON kid→PEM). Private key only for issuer (`ENTITLEMENT_LICENSE_PRIVATE_KEY` / CLI).
- Admin: `POST /v1/admin/licenses/issue`, `POST /v1/admin/licenses/activate`
- Client: `@luminaryworks/entitlement-client` `verifyLicenseLocal()` with product/feature/limit + expiry/grace checks

## Outbox notifications (Trial T-3 / expiry)

On `POST /v1/trials/ensure`, the service enqueues `trial.expiring` (T-3) and `trial.expired` with unique `dedupe_key`. Paid upgrade (`order.pay`) **cancels** pending trial notifications for that user+product.

| Channel | Adapter |
|---------|---------|
| In-app | Always-on sink (`GET /v1/notifications/in-app`) |
| Email | `@luminaryworks/notification` when SMTP configured |
| Push | `PushNotifyAdapter` + injectable `AppPushSender` interface |

User preferences: `GET/PUT /v1/notifications/preferences`. Delivery: poller with exponential backoff, max attempts → `dead` status. Admin force poll: `POST /v1/admin/outbox/poll`.

## Client

Use `@luminaryworks/entitlement-client` with `ENTITLEMENT_MODE=off|shadow_read|enforce`.

Product Guard order:

```text
LuminaryJwtAuthGuard → EntitlementGuard(feature) → PermissionGuard(Casbin)
```

## Migrations & rollback

```bash
pnpm migration:run       # apply pending (1730000000000 → 1730100000000)
pnpm migration:revert    # revert last migration only
pnpm seed                # idempotent catalog seed
```

**Traffic rollback (preferred):** set product `ENTITLEMENT_MODE=off` and restart — no schema drop.  
**Schema rollback:** `pnpm migration:revert` twice to unwind Todo3 then InitialSchema (destructive).  
Cross-repo verification notes: [`spec/entitlement-cross-repo-verification.md`](../../spec/entitlement-cross-repo-verification.md).

## Nest DI note

Injectable Nest/TypeORM classes (`DataSource`, `ConfigService`, `HealthCheckService`, …) must be **value imports**, not `import type`, so `emitDecoratorMetadata` / `@InjectDataSource()` resolve at runtime. Helpers: `scripts/fix-nestjs-imports.cjs`, `scripts/fix-nestjs-datasource-di.mjs`.
