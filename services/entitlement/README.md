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

## Listen port (frozen)

`ENTITLEMENT_PORT` defaults to **3040**. That is the only advertised listen port:

- standalone `services/entitlement/docker-compose.yml`
- control-plane `deploy/compose/control-plane.yaml` (`http://entitlement:3040` on the Compose network)
- Control Manifest `services.entitlement.url`
- product `ENTITLEMENT_BASE_URL` / `LW_ENTITLEMENT_URL`

Legacy **`7090` is retired**. Do not keep it as an alias in env files or docs. Never use `host.docker.internal`.

| Path | Meaning |
|------|---------|
| `GET /health` | process up (no dependency probes) |
| `GET /ready` | 503 when PostgreSQL is unreachable |
| `GET /version` | `service`, `apiVersion=v1`, `schemaVersion=1`, `gitSha` |
| OpenAPI | `http://localhost:3040/docs` |

## AI Platform is out of scope

This service does **not** make `ai=central` production-ready. The AI Platform currently has no AuthN, no Entitlement enforcement, only in-memory metering, no `/ready`, and no vault gate. `@luminaryworks/control-manifest` preflight therefore **refuses** `ai=central` for `pilot`/`production`; those deployments use `ai=off` or `ai=local_byok`. Flip `AI_CENTRAL_HARDENING_GATES` (`authn`, `entitlement`, `persistentMetering`, `secretVault`, `readiness`) in the **same** change that lands each capability — not before. See [`spec/composable-deployment.md`](../../spec/composable-deployment.md) §9.2.

## Auth

| Mode | Env | Behavior |
|------|-----|----------|
| `legacy` (dev) | `ENTITLEMENT_AUTH_MODE=legacy` | HS256 JWT with `ENTITLEMENT_LEGACY_JWT_SECRET` |
| `oidc` | issuer + audience | JWKS verify Logto / OIDC access tokens |
| Service | `X-Service-Key: $ENTITLEMENT_SERVICE_API_KEY` | Internal/admin; scopes include `entitlement:admin` |
| Partner M2M | `POST /v1/oauth/token` (`client_credentials`) | Returns `partner+jwt` Bearer; scoped `partner:*` |

**Subject identity** for user APIs always comes from verified `sub` (or service subject header for M2M). Request-body `subjectId` is never trusted for USER grants.

Admin routes (`/v1/admin/*`) require admin scope or service credential. Partner routes require partner token scopes. **Commercial entitlements never enter JWT.**

Browser CORS is **closed unless** `ENTITLEMENT_CORS_ORIGINS` lists the Control Console origin (production default empty).

`POST /v1/orders` is server-priced: callers send `offeringId` or `sku` (plus optional `providerHint` / `returnUrl`). Client `amountCents` / `amountMinor` / `currency` / `planCode` / `endsAt` are rejected (`PAYMENT_PRICE_MISMATCH`). Paid ToC subscriptions last **30 days** (month) or **365 days** (year); renewal extends `endsAt` from `max(now, currentEndsAt)`. Trial is never an offering. Unsellable products (`vistacast`, `syncrobrain`) return `PRODUCT_NOT_SELLABLE`. Quota packs remain server-priced via `packSku`; bundle SKUs still need a published offering. Manual/contract grants stay on `/v1/admin/grants`. Provider-neutral checkout lives in Entitlement: pay creates a `payment_attempt` and returns a hosted URL / QR / action. Public provider events use `POST /v1/payments/webhooks/:provider/:configId` (raw body verify, then idempotent fulfill). `POST /v1/orders/callbacks/:provider` is **admin/dev only** and cannot fulfill live Alipay/PayPal/Stripe/crypto. Store provider credentials with `PAYMENT_CONFIG_MASTER_KEY` (AES-256-GCM envelope); GET/audit never returns plaintext. Crypto (Coinbase / OKX / BitPay) is rejected when IP **or** billing country is CN.

Real adapters: **Alipay Face-to-Face** (`alipay_f2f`), **PayPal Checkout** (`paypal`), **WeChat Pay API v3** (`wechat_pay_v3`), **UnionPay / Cloud QuickPass** (`unionpay_quickpass`), **Stripe Checkout** (`stripe_checkout`), **Coinbase Business Checkout** (`coinbase_commerce`), **OKX Onchain OS / x402** (`okx_onchain`), and **BitPay** (`bitpay`) implement `PaymentAdapter`. Store credentials with `PAYMENT_CONFIG_MASTER_KEY` (AES-256-GCM envelope); GET/audit never returns plaintext. Crypto (Coinbase / OKX / BitPay) is rejected when IP **or** billing country is CN.

`POST /v1/orders/:id/complete` is the authenticated capture/confirm step after the buyer returns (PayPal `CAPTURE`; Alipay / WeChat / UnionPay / Stripe / Coinbase / BitPay re-query the provider; OKX x402 accepts `PAYMENT-SIGNATURE` / `paymentPayload` and fulfills only after official `verifyPayment` + `settlePayment` against the **stored** checkout action). It does **not** accept browser-provided amount, status, or replacement payment requirements. PayPal approval alone does not mark the order paid. Stripe `success_url`, Coinbase `successRedirectUrl`, and UnionPay `frontUrl` are not fulfillment. Coinbase Business Checkout is **USDC on Base** only. OKX challenges use a public `resourceBaseUrl` to build `/v1/orders/:id/complete`. BitPay refunds require official `bitpay-sdk` signing (`privateKey` + `merchantToken`); a merchant token alone is not enough.

Alipay notify ack is plain text `success`. WeChat ack is JSON `{ "code": "SUCCESS" }`. UnionPay `backUrl` ack is plain text `ok`. Public webhook: `POST /v1/payments/webhooks/:provider/:configId`. Setup: [`deploy/PAYMENTS.md`](../../deploy/PAYMENTS.md).

`PAYMENT_CONFIG_MASTER_KEY` is AES-256-GCM envelope encryption for those credentials. Production boot fails if provider configs are enabled and the key is missing. GET / audit / logs never return plaintext.

Quota features declare `meteringMode=counter|gauge` (default `counter`). API / monthly / voice consumption stays `consume`. Resource counts and bytes are gauges: products upsert an **absolute** amount for a `resourceId` (dashboard=1, object=bytes, Doris dataset=current logical bytes) and `release` when the resource goes away. Repeating the same amount is idempotent; releasing twice is idempotent. Snapshot `used/remaining` reads the `usage_counters` aggregate, which is updated in the same transaction as the allocation. If the aggregate drifts, `POST /v1/admin/usage/reconcile` rebuilds gauge totals from `resource_allocations`. Lowering a plan limit below current used keeps existing allocations, reports `remaining=0`, and rejects further increases.

Service API keys and webhook signatures use **constant-time** comparison (`timingSafeEqual` / length-safe helpers).

## Core APIs

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/entitlements` | Effective snapshot |
| POST | `/v1/entitlements/check` | Batch feature/quota check |
| POST | `/v1/entitlements/consume` | Atomic **counter** quota consume (+ Idempotency-Key) |
| POST | `/v1/entitlements/allocations` | Atomic **gauge** upsert of an absolute resource amount (+ Idempotency-Key) |
| POST | `/v1/entitlements/allocations/release` | Release a gauge allocation (idempotent; + Idempotency-Key) |
| POST | `/v1/trials/ensure` | One-time 7-day ToC trial per user+product; requires current policy accept |
| GET | `/v1/policies/current` | Current required legal manifest / URLs / acceptance state |
| POST | `/v1/policies/accept` | Persist versioned Terms + Privacy + Trial-deletion accept (token `sub` only) |
| GET | `/v1/catalog/plans` | Plan catalog (`trialPolicy`, `sellable`) |
| GET | `/v1/catalog/features` | Feature definitions |
| GET | `/v1/catalog/offerings` | Published sellable offerings only |
| POST | `/v1/orders` | Create order from `offeringId` / `sku` (server price) |
| POST | `/v1/orders/:id/pay` | Create `payment_attempt`; returns hosted URL / QR / action |
| POST | `/v1/orders/:id/complete` | Authenticated capture/query after buyer return; server snapshot only |
| POST | `/v1/payments/webhooks/:provider/:configId` | Public raw-body webhook (unknown/disabled config → 404) |
| GET | `/v1/payments/methods` | Operationally enabled providers for resolved geo + billing country |
| GET | `/v1/billing/profile` | Authenticated billing country |
| PUT | `/v1/billing/country` | Set billing country (immutable after successful payment) |
| GET | `/v1/admin/payments/orders` | Paginated admin order list (filters: status, subjectId, productCode) |
| GET | `/v1/admin/payments/orders/:id` | Order + attempts + refunds (redacted) |
| GET | `/v1/admin/payments/attempts` | Paginated admin attempt list |
| GET | `/v1/admin/payments/attempts/:id` | Attempt detail (redacted) |
| GET | `/v1/admin/payments/refunds` | Paginated admin refund list |
| GET | `/v1/admin/payments/providers` | List provider configs (redacted; never plaintext) |
| POST | `/v1/admin/payments/providers` | Create encrypted provider config |
| POST | `/v1/admin/payments/providers/:id/rotate` | Rotate credentials |
| POST | `/v1/admin/payments/providers/:id/test` | healthCheck; may probe remote token/gateway. List/checkout routes do not. |
| POST | `/v1/admin/payments/reconcile` | Query pending attempts |
| POST | `/v1/admin/payments/orders/:id/refund` | Idempotent refund; revoke entitlements after success |
| POST | `/v1/admin/payments/orders/:id/manual-confirm` | Admin mock/manual/contract confirm (actor/reason/ticket) |
| POST | `/v1/orders/callbacks/:provider` | **Dev/manual admin only** — not live user fulfillment |
| POST | `/v1/admin/grants` | Manual/contract grant |
| GET | `/v1/admin/catalog/revisions` | List catalog revisions |
| POST | `/v1/admin/catalog/revisions` | Create draft revision |
| PUT | `/v1/admin/catalog/revisions/:id/offerings` | Replace draft offerings |
| POST | `/v1/admin/catalog/revisions/:id/publish` | Publish draft (Ultra ⊇ Pro) |
| POST | `/v1/admin/catalog/revisions/:id/rollback` | Restore a previous revision |
| POST | `/v1/admin/usage/reconcile` | Rebuild gauge `usage_counters.used` from `resource_allocations` |
| GET | `/v1/admin/cleanup-jobs` | List Trial cleanup jobs |
| POST | `/v1/admin/cleanup-jobs/:id/retry` | Retry failed/dead `trial.purge` |
| POST | `/v1/admin/cleanup-jobs/:id/cancel` | Cancel a pending cleanup job |
| GET | `/v1/admin/policy-acceptances` | Read policy acceptances |
| GET | `/v1/admin/audit` | Read audit log |

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

## Outbox notifications (Trial T-3 / T-1 / expiry / purge)

On `POST /v1/trials/ensure`, after the current legal bundle is accepted, the service enqueues `trial.expiring` (T-3), `trial.expiring_t1` (T-1), `trial.expired`, and signed-delivery `trial.purge`, all with unique `dedupe_key` and `trialRedemptionId` / `subscriptionId` / `logtoSub` / `productCode` / `startsAt` / `endsAt` / `policyVersion`. A `trial_cleanup_jobs` row is persisted at `endsAt`.

Paid upgrade (`order.pay` for a non-trial plan) acquires the same per-user/product advisory lock as purge delivery and **cancels** pending T-3 / T-1 / expired / purge events plus the pending cleanup job before committing paid entitlement. Pending (unpaid) orders do not stop purge. Fixed-period renewal (`max(now, currentEndsAt)+interval`) is unchanged.

`trial.purge` is not a marketing notification. The outbox handler:

1. Takes `pg_advisory_xact_lock` for `trial-purge:{logtoSub}:{productCode}`
2. Re-checks active non-trial paid / org / deployment entitlement
3. Cancels if paid; otherwise POST raw JSON to `ENTITLEMENT_TRIAL_PURGE_TARGETS[productCode]`
4. Signs with HMAC-SHA256 over `` `${timestamp}.${nonce}.${rawBody}` `` (`x-lw-signature: v1=<base64url>`), plus `x-lw-timestamp`, `x-lw-nonce`, `x-lw-event-id`, `x-lw-job-id`
5. Expects HTTP 2xx JSON `{ "ok": true, "jobId"?: "...", "eventId"?: "..." }`. Non-2xx or invalid ack retries. Missing target retries / dead-letters and **never** marks sent.

Current legal version defaults to `lw-legal-v2026-09-07` (`ENTITLEMENT_LEGAL_POLICY_VERSION`). `POST /v1/trials/ensure` returns `TRIAL_POLICY_NOT_ACCEPTED` (400) until Terms, Privacy, and Trial-deletion for that version are accepted. Subject is always the verified token `sub` (or `X-Act-As-Subject` for service/admin). Disabled-trial products (DoerFlow / VistaCast / SyncroBrain) still fail with `PRODUCT_TRIAL_DISABLED` before any acceptance write. Enterprise and private-license skip paths still skip Trial without requiring a new accept.

Product HTTP purge endpoints are **not** implemented in this change; each product must accept the signed body and respond with the ack shape above. Deletion is irreversible and must key off `trialRedemptionId` + billing owner, not a vague creator match.

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
pnpm migration:run       # apply pending (1730000000000 → 1730700000000)
pnpm migration:revert    # revert last migration only
pnpm seed                # idempotent catalog seed
```

**Traffic rollback (preferred):** set product `ENTITLEMENT_MODE=off` and restart — no schema drop.  
**Schema rollback:** `pnpm migration:revert` twice to unwind Todo3 then InitialSchema (destructive).  
Cross-repo verification notes: [`spec/entitlement-cross-repo-verification.md`](../../spec/entitlement-cross-repo-verification.md).

## Nest DI note

Injectable Nest/TypeORM classes (`DataSource`, `ConfigService`, `HealthCheckService`, …) must be **value imports**, not `import type`, so `emitDecoratorMetadata` / `@InjectDataSource()` resolve at runtime. Helpers: `scripts/fix-nestjs-imports.cjs`, `scripts/fix-nestjs-datasource-di.mjs`.
