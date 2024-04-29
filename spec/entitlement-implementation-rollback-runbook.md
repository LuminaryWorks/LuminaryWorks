# Entitlement implementation & rollback runbook

> Todo 7 companion. Authority: [spec/subscription-and-entitlement.md](./subscription-and-entitlement.md).  
> Rollout order for `ENTITLEMENT_MODE`: **DataLuminary → BlockyEdu → VistaRemote**.  
> Acceptance evidence: [entitlement-acceptance-matrix.md](./entitlement-acceptance-matrix.md) (second pass 2024-04-29).

## Architecture (must hold)

```text
AuthN (Logto / product JWT) → Entitlement (commercial) → Casbin/ABAC (resource ACL)
```

Frozen rules:

1. Authenticated `subjectId` never comes from request body.
2. Business entitlements are **not** authoritative in JWT.
3. Private License never sets Casbin bypass (`casbinBypass: false`).
4. Commercial deny → **402**; AuthN fail → **401**; resource ACL deny → **403**.
5. Write paths fail closed when entitlement state is uncertain (`ENTITLEMENT_MODE=enforce`).
6. Entitlement **allow** must never skip ownership / Casbin resource checks.

## Components

| Component | Path |
|-----------|------|
| Central service | `services/entitlement` |
| Shared client | `shared/packages/entitlement-client` (`@luminaryworks/entitlement-client`) |
| DataLuminary | `DataTalk` + `DataView` |
| BlockyEdu | `edu-server`, `server`, `edu-app-web`, `code-app-web` |
| VistaRemote | `shared`, `server`, `web`, `desktop`, `mobile` |
| DoerFlow | `repos/api`, `web`, `admin`, `wallet`, `worker`（`trialPolicy=disabled`） |

## Local central service (Docker Postgres)

```bash
cd services/entitlement
cp env.example .env   # if needed
pnpm install
docker compose up -d entitlement-db
pnpm run migration:run   # includes outbox lease columns (locked_until / locked_by)
pnpm run seed
pnpm run build && node dist/main.js
# GET http://127.0.0.1:3040/health → {"status":"ok"}
```

Outbox workers are multi-instance safe: claim uses `SELECT … FOR UPDATE SKIP LOCKED` with lease expiry recovery (`OUTBOX_CLAIM_SQL`). Configure `outboxLeaseSeconds` / `outboxWorkerId` if needed.

Do **not** commit `.env`, PEM private keys, or filled `ENTITLEMENT_LICENSE_PRIVATE_KEY`.

## Product env flags

| Variable | Values | Meaning |
|----------|--------|---------|
| `ENTITLEMENT_MODE` | `off` \| `shadow_read` \| `enforce` | Local-only / dual-read / central authoritative |
| `ENTITLEMENT_SERVICE_BASE_URL` | URL | Central service |
| `ENTITLEMENT_SERVICE_API_KEY` | secret | M2M to central (server-side only) |
| `ENTITLEMENT_OFFLINE_GRACE_MS` / `_SECONDS` | `0` default | Offline grace; keep `0` until grace is subject-keyed and monitored |
| `ENTITLEMENT_LICENSE_PAYLOAD` / public keys | PEM/JSON | Private deploy License (commercial only) |
| `PRODUCT_CODE` | `dataluminary` / `blockyedu` / `vistaremote` | Bundle isolation key |

## Shadow-read rollout order

### Phase A — DataLuminary first

1. Deploy central entitlement (migrate + seed) in shared env.
2. Point DataTalk at central with `ENTITLEMENT_MODE=shadow_read`.
3. Confirm AuthN → EntitlementGuard → PermissionGuard on gated routes.
4. Watch shadow-diff logs for Trial / Pro / Ultra / org seat mismatches.
5. When diffs are acceptable for allowlist orgs/users, switch DataTalk to `enforce`.
6. DataView UX already keys off `/membership` + 402; no commercial claims in SPA tokens.

### Phase B — BlockyEdu

1. Keep `edu-server` / `server` on `shadow_read` after DataLuminary enforce is stable.
2. Confirm code-server `@RequireEntitlement` on execute/AI (`/ai/*`).
3. Confirm edu-server `@RequireEntitlement(student.limit)` on learner provisioning (`POST /users`, role→learner). AI tutor/teacher HTTP is **not** on edu-server; `course.limit` is **not** in the frozen catalog.
4. Flip `server` then `edu-server` to `enforce` independently if needed.
5. Frontend: edu-app-web builds must use `NODE_ENV=production` (`pnpm run build` sets this via `cross-env`).

### Phase C — VistaRemote last

1. Ensure Controller JWT is required for billing commercial APIs when mode ≠ `off`.
2. Confirm `plan` is not required in JWT; clients read `/api/v1/billing/entitlements`.
3. Confirm `ResourceAccessService` runs **after** entitlement on device claim, pairing/session join, and recording playback (402 ≠ 403).
4. `shadow_read` on server; SFU/AI/recording gates dual-read.
5. Flip to `enforce` after DataLuminary + BlockyEdu are green.

### Phase D — DoerFlow no-trial rollout

Local Todo 6 evidence (2024-04-29):

1. **PASS** — live central catalog contains Pro / Ultra / Enterprise only for DoerFlow and reports `trialPolicy=disabled`; unit and DB integration reject ensure/order/partner/admin Trial creation with `PRODUCT_TRIAL_DISABLED`.
2. **PASS** — API tests prove SIWE subjects map through trusted wallet links, organization spoofing is 403, seat occupation is service-authenticated, and wallet-link proofs validate domain/URI/chain/address/time/nonce/replay.
3. **PASS** — web membership/error tests pass; no Trial CTA/countdown exists; public chain signing and protocol fees remain separate from platform membership.
4. **PASS** — admin uses Logto bearer + central entitlement + durable Casbin permissions; wallet/worker platform error tests pass and keys remain device-local.
5. **PASS locally** — 401/402/403, Ed25519, Casbin-after-entitlement and payment service-scope tests pass. A quota replay bypass found during review was fixed: committed/in-flight idempotency keys now return 409 and cannot execute a second mutation.

Exact command evidence is in [entitlement-acceptance-matrix.md](./entitlement-acceptance-matrix.md). Roll back with `ENTITLEMENT_MODE=shadow_read|off`; do not alter protocol fees or chain contracts.

Decision: **GO for `shadow_read`**. **Conditional GO for canary `enforce`** only after target-environment Logto callback/token, SIWE bind/replay and chain receipt/signing E2E. **NO-GO for full `enforce`** until shadow-diff soak and canary telemetry are clean.

## Rollback

| Mode flip | Action |
|-----------|--------|
| Immediate commercial rollback | Set `ENTITLEMENT_MODE=off` on the product (local membership / License path). No JWT entitlement required. |
| Partial | Keep `shadow_read` (local decision wins; central for audit only). |
| Central outage under enforce | Fail closed (402/503). Optionally raise offline grace only after confirming subject-keyed cache. |
| Schema | Do **not** drop legacy plan/trial columns until audit window closes. Migration scripts are idempotent / dry-run capable. |
| Outbox lease stuck | Expired `locked_until` rows are reclaimed by the next worker; cancel clears processing leases. |

Central service rollback: stop traffic to products (`off`), then revert service deploy. DB migrations are additive for LW-ENT; revert only with `migration:revert` if a new migration is unsafe.

## Security checklist (ops)

- [x] No private keys in git / env examples (rollout-tree scan; placeholders/dev examples only)
- [x] Partner scopes + HMAC replay window enabled (unit coverage)
- [x] User tokens cannot pass arbitrary `organizationId` / `deploymentId` (403 coverage)
- [x] Seat occupy only via service/admin (`POST /v1/entitlements/seats/occupy` or admin)
- [x] License verify never grants Casbin ACL (`casbinBypass=false`)
- [x] Simulate-paid disabled by default (`BILLING_ALLOW_SIMULATE_PAID` unset)
- [x] Multiple entitlement service replicas: outbox claim lease indexes present (`migration:run`)
- [x] DoerFlow privileged task/payment paths bind wallet/service identity and enforce Casbin after commercial allow
- [ ] Target environment: complete live Logto + chain E2E and observe shadow-diff soak before full enforce

## Related docs

- Acceptance matrix/report: [entitlement-acceptance-matrix.md](./entitlement-acceptance-matrix.md)
- Spec: [subscription-and-entitlement.md](../spec/subscription-and-entitlement.md)
- Product notes: `spec/products/{dataluminary,blockyedu,vistaremote}.md`
