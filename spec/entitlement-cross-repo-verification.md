# Entitlement cross-repo verification (Todo 7)

> **Date**: 2024-04-29 · **Agent**: Grok 4.5 High Fast · **Frozen contract**: [subscription-and-entitlement.md](./subscription-and-entitlement.md)  
> **Scope**: Central service + DataLuminary / BlockyEdu / VistaRemote product adapters  
> **Constraints**: no Cursor plan edits · no git commit · preserve unrelated WIP

---

## 1. Verdict

Central Entitlement service is **startable** against local Docker Postgres with migrations + seed. Core AuthN trust boundaries, Trial uniqueness, seat occupy, order ownership, and 401/402/403 separation were verified with live smoke calls. Product adapters keep commercial facts out of JWT and support `ENTITLEMENT_MODE=off|shadow_read|enforce`.

Several **rollout defects were fixed** during this pass (see §5). Remaining items are classified in §8.

---

## 2. Git roots inspected

| Root | Branch (status) | Rollout-related WIP |
|------|-----------------|---------------------|
| `LuminaryWorks/` | `master` | `services/entitlement`, specs, scripts |
| `LuminaryWorks/shared/` | nested `master` | `packages/entitlement-client`, `notification` |
| `dataluminary/DataTalk/` | `feat/permission` | entitlement module + migrations |
| `dataluminary/DataView/` | `feat/permission` | membership UI / 402 UX |
| `blockyedu/edu-server/` | `main` (ahead 1) | entitlement module |
| `blockyedu/server/` | `feat/standalone-deploy-profile` | entitlement gates on code/AI |
| `blockyedu/edu-app-web/` | `feat/deploy-profile-standalone` | Next membership UX |
| `blockyedu/code-app-web/` | `feat/deploy-profile-standalone` | membership store / 402 |
| `vistaremote/shared/` | `main` | billing catalog / error-map |
| `vistaremote/server/` | `main` | central billing adapter |
| `vistaremote/web/` | `main` | client/admin entitlement UX |
| `vistaremote/desktop/` | `main` | entitlements client |
| `vistaremote/mobile/` | `main` | entitlements client |

---

## 3. Contract checklist vs implementation

| Check | Result |
|-------|--------|
| AuthN → Entitlement → Casbin/ABAC order | **Pass** (product Guards; service has no Casbin — correct) |
| No business entitlements in JWT | **Pass** |
| Stable 401 / 402 / 403 | **Pass** (filters + `ERROR_HTTP_STATUS`) |
| No body-controlled subject escalation | **Pass** (token `sub` / act-as only) |
| No body/query org/deployment escalation (user) | **Fixed + smoke 403** |
| Internal / service / admin / partner scopes | **Pass** |
| Trial unique `(logto_sub, product_code)` + enterprise/private skip | **Pass** |
| Paid upgrade cancels Trial outbox | **Fixed** (order + admin + partner) |
| Quota concurrency / idempotency | **Pass** (row lock + idempotency table) |
| Org seat occupy API | **Fixed** (`POST /v1/admin/seats/occupy`, `/v1/entitlements/seats/occupy`) |
| Bundle only declared products | **Fixed** (catalog product check on create/fulfill) |
| Partner replay / HMAC / raw body | **Pass** |
| Ed25519 tamper / expiry / grace / kid; no Casbin bypass; no private keys in ring | **Pass** (grace default **opt-in**) |
| Outbox retry / dedupe / dead | **Pass** (poll errors no longer crash process) |
| `ENTITLEMENT_MODE` off / shadow_read / enforce + fail-closed | **Pass** (client) |

---

## 4. Test matrix (commands → outcomes)

### 4.1 LuminaryWorks central

| Command | cwd | Outcome |
|---------|-----|---------|
| `pnpm check` | `services/entitlement` | **Pass** |
| `pnpm test` | `services/entitlement` | **Pass** (5 suites / 32 tests) |
| `pnpm build` | `services/entitlement` | **Pass** |
| `pnpm lint` | `services/entitlement` | **Pass** |
| `pnpm check && pnpm test && pnpm build` | `shared/packages/entitlement-client` | **Pass** (9 tests) |
| `docker compose up -d entitlement-db` | `services/entitlement` | **Pass** (`luminary-entitlement-db`) |
| `pnpm migration:run` | `services/entitlement` | **Pass** (`1730000000000` → `1730100000000`) |
| `pnpm seed` | `services/entitlement` | **Pass** |
| `node dist/main.js` (port 3040) | `services/entitlement` | **Pass** (after DI + column fixes) |

### 4.2 Startup smoke (live `:3040`)

| Call | Outcome |
|------|---------|
| `GET /health` | 200 `{status:ok}` |
| `GET /ready` | 200 database up |
| `GET /v1/catalog/plans` | 200 (3 products) |
| `POST /v1/trials/ensure` | 200 created=true then idempotent created=false |
| `GET /v1/entitlements?productCode=dataluminary` | 200 `effectivePlan=trial` then `pro` after pay |
| `GET …&organizationId=org_attacker` (user JWT with other org) | **403** |
| `GET …&deploymentId=dep_x` (user JWT) | **403** |
| no Authorization | **401** |
| `POST /v1/orders/:id/pay` as other user | **403** |
| owner pay mock order | paid → `effectivePlan=pro` |
| `POST /v1/admin/seats` + `/occupy` (service key) | seatUsed=1 |

### 4.3 Products

| Repo | Command | Outcome |
|------|---------|---------|
| DataTalk | `pnpm test -- src/modules/entitlement` | **Pass** (12) |
| DataView | `pnpm test -- src/store/membership.test.ts src/utils/membership.test.ts` | **Pass** (8) |
| edu-server | `pnpm test` | **Pass** (13) |
| blockyedu/server | `pnpm test` | **Pass** (13) |
| edu-app-web | `pnpm exec biome check .` | **Fail** — Biome **2.4.16** aligned; **~220 pre-existing** lint findings remain |
| vistaremote/server | `pnpm test` | **Pass** (46) |
| vistaremote/shared | `pnpm lint` | **Fail** — **PRE_EXISTING** (~74 Biome diagnostics) |

JSON: root + entitlement + shared client `package.json` parse **OK**. Ecosystem `--verify` still reports unrelated BOM/parse noise (`.tmp-*`, website empty `package.json`, bcryptjs vendor) — **OUT_OF_SCOPE**.

---

## 5. Files fixed in this pass

### LuminaryWorks / shared

- `services/entitlement/src/auth/principal-context.ts` (+ tests)
- `services/entitlement/src/modules/entitlements/entitlements.controller.ts` — trusted org/deployment; seats/occupy
- `services/entitlement/src/modules/trials/trials.controller.ts`
- `services/entitlement/src/modules/orders/{orders.controller,orders.service,orders.module}.ts` — pay ownership + declared products
- `services/entitlement/src/modules/admin/{admin.controller,admin.service,admin.module}.ts` — seat occupy + cancel trial notify
- `services/entitlement/src/modules/partner/partner-redemption.service.ts` — cancel trial notify
- `services/entitlement/src/modules/*/…service.ts` — `@InjectDataSource` + value `DataSource` import
- `services/entitlement/src/modules/health/health.controller.ts` — Nest DI value imports
- `services/entitlement/src/modules/notify/outbox.service.ts` — poll error isolation
- `services/entitlement/src/database/entities/outbox-event.entity.ts` — `last_error` column name
- `services/entitlement/src/database/entities/usage-counter.entity.ts` — `limit_value` column name
- `services/entitlement/scripts/fix-nestjs-imports.cjs`, `fix-nestjs-datasource-di.mjs`
- `shared/packages/entitlement-client/src/license/verify.ts` — grace **opt-in**
- `shared/packages/entitlement-client/src/license.spec.ts`
- `services/entitlement/README.md` / this report / runbook below

### VistaRemote

- `server/src/billing/billing-identity.ts` (new)
- `server/src/billing/billing.controller.ts` — Controller JWT required when mode ≠ off
- `server/src/billing/entitlement.spec.ts`
- `server/src/billing/trial-notify.service.ts` — no fake SMTP/FCM success
- `server/src/devices/devices.service.ts` — claimOwner + quota on bind
- `server/src/devices/devices.controller.ts` — register owner from JWT; `claim-owner`

### BlockyEdu

- `server/src/modules/code-runner/code-runner.controller.ts` — externalUserId for snapshot
- `server/src/modules/rbac/rbac.service.ts` — `AuthUserDto.externalUserId`
- `edu-app-web/package.json` — `@biomejs/biome` **2.4.16** (schema match)

---

## 6. Rollout flags

| Flag | Values | Behavior |
|------|--------|----------|
| `ENTITLEMENT_MODE` | `off` \| `shadow_read` \| `enforce` | Product-side only; central always authoritative when called |
| `ENTITLEMENT_BASE_URL` | URL | Central API |
| `ENTITLEMENT_SERVICE_API_KEY` | secret | Product → central M2M |
| `ENTITLEMENT_CACHE_TTL_*` / `OFFLINE_GRACE_*` | ms/s | Client cache / fail-closed grace |
| `ENTITLEMENT_LICENSE_PUBLIC_KEYS` | JSON kid→PEM | Public ring only |
| Product order | DataLuminary → BlockyEdu → VistaRemote | Per frozen §13 |

Recommended path: `off` → `shadow_read` (diff logs) → % enforce → full enforce. Keep legacy local membership columns until audit.

---

## 7. Migration / rollback runbook

### Central DB

```bash
cd services/entitlement
cp env.example .env          # never commit secrets
docker compose up -d entitlement-db
pnpm install
pnpm migration:run           # 1730000000000 then 1730100000000
pnpm seed
pnpm build && node dist/main.js   # or: pnpm start:dev
```

MetaRepo shortcuts: `pnpm ent:up` · `pnpm ent:migrate` · `pnpm ent:seed` · `pnpm ent:dev`.

**Rollback schema** (one step at a time):

```bash
pnpm migration:revert   # reverts Todo3Extensions
pnpm migration:revert   # reverts InitialSchema (destructive)
```

**Rollback traffic** (non-destructive): set all products `ENTITLEMENT_MODE=off` and restart; local membership facts remain.

### Product legacy migrations (repeatable scripts)

| Product | Script |
|---------|--------|
| DataTalk | `pnpm migrate:legacy-membership` |
| BlockyEdu edu-server / server | `pnpm migrate:legacy-membership` |
| VistaRemote server | `pnpm migrate:legacy-billing` |

Do **not** drop legacy columns until shadow-read audit is clean.

---

## 8. Known blockers (classified)

| Item | Class | Notes |
|------|-------|-------|
| DataTalk / DataView broad lint/type debt | **PRE_EXISTING** | Entitlement-focused tests pass; no new failures attributed in this pass |
| edu-app-web Biome schema vs package | **FIXED (config)** | Bumped to 2.4.16; **~220 lint findings remain PRE_EXISTING** |
| VistaRemote `shared` Biome lint (~74) | **PRE_EXISTING** | Tooling/format noise; not introduced by identity mapping fixes |
| edu-server few `@RequireEntitlement` commercial gates | **ROLL_OUT residual / product policy** | Membership + trial wired; bool commercial gates live on `blockyedu/server` (code/AI). LMS catalog has no dedicated live feature code yet — do not fake-map |
| VistaRemote Trial email/push | **ROLL_OUT residual** | Adapters no longer claim success without SMTP/FCM; real transport still product wiring |
| DataTalk/BlockyEdu client-supplied org header without membership proof | **ROLL_OUT residual** | Central now rejects user org escalation; products should stop forwarding unverified `x-organization-id` |
| Ecosystem JSON verify noise (`.tmp-*`, website, vendor) | **OUT_OF_SCOPE** | Unrelated to entitlement rollout |

---

## 9. Unresolved risks

1. **Product org context**: even with central enforcement, product Guards that forward arbitrary `x-organization-id` should membership-check before calling central.
2. **edu-server commercial surface**: until feature codes exist for LMS-only paid actions, enforce mode will not gate most edu-server routes (by design today).
3. **VistaRemote clients** still send `x-user-id` for local `off` mode; enforce requires Controller JWT — coordinate client Authorization headers before flipping VR to enforce.
4. **Biome `import type` vs Nest DI**: scripts added to restore value imports; re-running aggressive organize-imports can regress startup — keep `useImportType` off for Nest injectables.
5. **No commit** in this pass; uncommitted WIP across many repos remains large — review before PR.

---

## 10. Package / env hygiene

- Packages: `@luminaryworks/entitlement-service`, `@luminaryworks/entitlement-client` (`file:` links from products).
- `env.example` placeholders only; `.gitignore` covers `.env`, `*.pem`, `license-keys/`.
- UTF-8 no BOM for edited sources; do not use PowerShell `Set-Content -Encoding UTF8` on JSON.
