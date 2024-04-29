# Entitlement Todo 7 — automated acceptance matrix & report

**Date:** 2024-04-29 (second pass — rollout blockers fixed)  
**Scope:** Cross-repo entitlement rollout verification  
**Rollout order:** DataLuminary → BlockyEdu → VistaRemote  
**Runbook:** [entitlement-implementation-rollback-runbook.md](./entitlement-implementation-rollback-runbook.md)

## Verdict

| Area | Status |
|------|--------|
| Central service + client correctness | **PASS** (unit + migrate/seed + `/health` smoke) |
| Outbox multi-instance claim (`FOR UPDATE SKIP LOCKED` + lease recovery) | **PASS** |
| Security invariants (subject trust, License≠Casbin bypass, ACL after entitlement) | **PASS** with residual product-surface notes |
| DataLuminary entitlement paths | **PASS** (tests/build); full-repo lint/type-check noise is pre-existing |
| BlockyEdu servers (`edu-server` + code `server`) | **PASS** |
| VistaRemote shared + server (ACL on gated privileged ops) | **PASS** (tests/build) |
| Frontend hygiene (edu-app build / code-app Biome config) | **PASS** build + config parse; code-app still has pre-existing lint rule debt |
| Full multi-product org-wide `enforce` soak | **CONDITIONAL** — see shadow-read table |
| **Acceptance complete for Todo 7 blockers?** | **Yes** for the three required blockers + optional localized frontend fixes; staging IdP E2E still not run |

---

## Security / architecture matrix

| # | Check | Result | Evidence |
|---|--------|--------|----------|
| 1 | AuthN → Entitlement → Casbin | **PASS** | DataTalk / BlockyEdu APP_GUARD order; Vista `ResourceAccessService` after entitlement on device/session/recording |
| 2 | Subject never from untrusted body | **PASS** | `resolveSubject`, `billing-identity.ts`, membership controllers |
| 3 | No business entitlements in JWT | **PASS** | `principalFromPayload`; Vista `plan` optional / omitted from new tokens |
| 4 | License never bypasses Casbin | **PASS** | `casbinBypass: false` + tests; edu-server License still runs under `mode=off` |
| 5 | 401 / 402 / 403 | **PASS** | `ERROR_HTTP_STATUS`; edu-server entitlement.spec; Vista ACL → 403 |
| 6 | One-time concurrent trial | **PASS** | advisory lock + unique `(logtoSub, productCode)` |
| 7 | Enterprise trial bypass / seat | **PASS** | trials service; `POST .../seats/occupy` |
| 8 | Partner OAuth / replay / idempotency | **PASS** | partner module + crypto tests |
| 9 | Ed25519 tamper / expiry / grace / kid | **PASS** | license-partner-crypto + client license.spec |
| 10 | Quota concurrency / idempotency | **PASS** | consume + unique idempotency |
| 11 | Outbox T-3 / expiry / retry / dedupe / cancel / multi-instance | **PASS** | `outbox-claim.ts` + `OUTBOX_CLAIM_SQL` + migration `1730200000000-OutboxLeaseClaim` + `outbox-claim.spec.ts` |
| 12 | `off` / `shadow_read` / `enforce` | **PASS** | client modes + product config |
| 13 | Cache invalidation / fail-closed | **PASS** | subject-keyed offline grace |
| 14 | Bundle product isolation | **PASS** | seed + order fulfillment per `productCode` |
| 15 | Secrets / private keys in tree | **PASS** | scan clean; env.example placeholders |
| 16 | Org IDOR via query/body | **PASS** | `auth/principal-context.ts` |

---

## Commands & results (per repo) — second pass re-run

### LuminaryWorks — `services/entitlement`

| Command | Result |
|---------|--------|
| `pnpm run lint` | **PASS** |
| `pnpm run check` | **PASS** |
| `pnpm run test` | **PASS** (39 tests; includes `outbox-claim.spec.ts`) |
| `pnpm run build` | **PASS** |
| `docker compose up -d entitlement-db` | **PASS** (Postgres healthy) |
| `pnpm run migration:run` | **PASS** (lease columns applied; no pending) |
| `pnpm run seed` | **PASS** |
| `GET http://127.0.0.1:3040/health` | **PASS** `{"status":"ok"}` |

### LuminaryWorks — `shared/packages/entitlement-client`

| Command | Result |
|---------|--------|
| `pnpm run test` | **PASS** (9 tests) |

### Encoding / secrets

| Check | Result |
|-------|--------|
| `node scripts/ecosystem-fix-json-encoding.mjs --verify` | **FAIL ecosystem-wide** — pre-existing outside entitlement trees |
| JSON.parse + BOM on entitlement trees + key specs | **PASS** |
| Private key / live secret scan (entitlement trees) | **PASS** |

### DataLuminary

| Repo | lint | test | build |
|------|------|------|-------|
| DataTalk (entitlement paths) | PASS (scoped) | PASS | PASS |
| DataView | FAIL repo-wide (pre-existing) | PASS | PASS |

### BlockyEdu

| Repo | lint | test | build | Notes |
|------|------|------|-------|-------|
| `edu-server` | **PASS** | **PASS** (17 entitlement tests) | **PASS** | `@RequireEntitlement(student.limit)` on learner mutations; AI/`course.limit` documented absences |
| `server` (code) | PASS | PASS | PASS | AI tutor/copilot gates already on `/ai/*` |
| `edu-app-web` | FAIL (repo biome noise) | — | **PASS** | Build forced `NODE_ENV=production` via `cross-env` (fixes App Router `/404` when shell has `NODE_ENV=development`) |
| `code-app-web` | **PARTIAL** | — | PASS | Biome upgraded to 2.x + local overrides; config `includes` mismatch **fixed**; 11 pre-existing lint rule errors remain (no mass format) |

### VistaRemote

| Repo | Result | Notes |
|------|--------|-------|
| `shared` test/build | **PASS** | |
| `server` test | **PASS** (51 tests; resource-access + devices + pairing) | Entitlement success cannot bypass device/session/recording ACL |
| `server` build | **PASS** | |
| `server` lint | **FAIL** | Vendor/biome noise (**pre-existing**) |
| `web` test | **FAIL** | Playwright/rstest (**pre-existing**) |
| `web` / `desktop` / `mobile` | build or unit as prior | Not re-blocking Todo 7 |

---

## Fixes in Todo 7 (including second-pass blockers)

### First pass
1. **entitlement-client** — Offline grace keyed by cache key; regression test.
2. **entitlement service** — Org/deployment trust; seat occupy for service/admin.
3. **VistaRemote** — Billing identity / JWT `plan` optional; auth on billing APIs.
4. **DataTalk** — Space↔org ACL; License under `mode=off`; upload compensate.
5. **BlockyEdu code-server** — Runtime subject = `externalUserId`.

### Second pass (required blockers)
1. **edu-server** — `@RequireEntitlement(FEATURE.STUDENT_LIMIT)` + consume on `POST /users`, role→learner mutations; guard org match; 401/402/403/trial/enterprise/license/shadow tests. **Exact absences documented:** no AI tutor/teacher HTTP on edu-server (lives on `blockyedu/server` `/ai/*`); `course.limit` not in frozen catalog.
2. **Outbox** — Migration `locked_until` / `locked_by`; atomic claim SQL with `FOR UPDATE SKIP LOCKED`; expired-lease recovery; retry/dead-letter helpers + tests; registered in `data-source.ts`.
3. **VistaRemote Casbin/ABAC** — `ResourceAccessService` on device claim, pairing join (session), recording playback; tests prove entitlement pass ≠ ACL bypass. No separate file-transfer HTTP API; recording path uses `file:` Casbin key.
4. **Optional frontend** — edu-app-web `build` scripts set `NODE_ENV=production`; code-app-web Biome 2.x + formatter/assist local overrides (no broad reformat).

---

## Remaining non-blockers (not Todo 7 acceptance gates)

| Item | Severity | Notes |
|------|----------|-------|
| code-app-web 11 Biome lint rule errors | Low | Config mismatch fixed; rule debt separate |
| DataView / DataTalk / Vista web repo-wide lint | Low | Pre-existing |
| Ecosystem JSON encoding `--verify` | Low | Outside entitlement trees |
| Full E2E partner redeem + License rotate vs staging IdP | Ops | External dependency / env not available here |
| Product Casbin on every Vista surface beyond gated ops | Medium backlog | Privileged entitlement-touched ops covered |

---

## Shadow-read go / no-go

| Product | Shadow-read | Enforce |
|---------|-------------|---------|
| DataLuminary | **GO** | **CONDITIONAL GO** after shadow-diff soak |
| BlockyEdu (`server` / code) | **GO** | **CONDITIONAL** (execute/AI gated) |
| BlockyEdu (`edu-server` LMS) | **GO** | **CONDITIONAL GO** for `student.limit` paths; AI remains on code-server |
| VistaRemote | **GO** | **CONDITIONAL GO** after soak; ACL on device/session/recording gated ops |

**Acceptance complete for Todo 7 required rollout blockers?**  
**Yes — fixed and verified with command evidence above.** Org-wide production `enforce` remains a phased soak decision (shadow-diff), not an open implementation blocker for the three required items.

## Todo 6 — DoerFlow final acceptance (2024-04-29)

### Security and correctness

| Check | Result | Evidence |
|-------|--------|----------|
| Dual identity | **PASS** | `TrustedSubjectService` keeps Logto `sub` and SIWE wallet users separate; SIWE reaches central entitlement only through a durable wallet link |
| Wallet binding proof | **PASS** | Tests cover domain, URI, chain, address, issued/expiry window, account-bound one-time nonce and replay rejection |
| No Trial | **PASS** | Central unit + DB integration reject ensure/order/partner/admin Trial writes; live catalog has DoerFlow `disabled` and only Pro/Ultra/Enterprise |
| Existing Trial products | **PASS** | DB integration proves one redemption and exactly 7 days for `standard_7d`; live catalog retains Trial for DataLuminary/BlockyEdu/VistaRemote |
| Admin authority | **PASS** | Strict Logto bearer → entitlement → durable Casbin `PermissionGuard`; no mock/password/wallet authority |
| Task/payment writes | **PASS** | Task addresses bind to authenticated/linked wallet; ledger credit requires issuer/audience/HS256/service scope; snapshot requires entitlement + Casbin |
| Org/seat trust | **PASS** | Organization comes from verified Logto claim + mapping; spoofed header/body is 403; seat occupation requires central service key |
| Quota idempotency | **FIXED + PASS** | Committed/in-flight idempotency-key replay is 409 and cannot re-enter the mutation; failed mutation retries do not double-consume |
| License | **PASS** | Ed25519 kid/signature/expiry/tamper tests pass; private keys rejected from public ring; `casbinBypass=false` |
| Client custody / protocol | **PASS** | No Trial UI matches; web/wallet/worker keep wallet signing and chain fees independent from platform plans |
| Secret scan | **PASS** | No committed PEM/private key or filled service secret in rollout trees; examples contain placeholders/dev-only values |

Security review found one high-severity committed-reservation replay bypass. Todo 6 fixed it in `quota-reservation.service.ts` and added a regression test; the API suite passes 33/33.

### Commands and actual outcomes

| Cwd | Command | Outcome |
|-----|---------|---------|
| `services/entitlement` | `pnpm lint; pnpm check; pnpm build` | **PASS** |
| `services/entitlement` | `pnpm test` | **PASS** — 7 suites, 44 tests; DB suite gated |
| `services/entitlement` | `pnpm migration:run; pnpm seed` | **PASS** — no pending migration; seed complete |
| `services/entitlement` | `RUN_DB_INTEGRATION=1 pnpm exec jest --config jest.config.cjs --runInBand test/doerflow-trial-policy.integration.spec.ts` | **PASS** — 2/2 |
| `services/entitlement` | `node dist/main.js`; `GET /health`, `/ready`, `/v1/catalog/plans` | **PASS** — 200/200/200, database up |
| `shared/packages/entitlement-client` | `pnpm test; pnpm check; pnpm build` | **PASS** — 11 tests |
| `identity` | JSON parse/BOM + SPA/audience/URI invariants | **PASS** — 3 files |
| `identity` | `node scripts/register-apps.mjs` | **PASS** — DoerFlow Admin exists as independent SPA; VibeAgent API audience exists |
| `doerflow/repos/api` | `pnpm test -- --runInBand`; `pnpm build` | **PASS** — 11 suites, 33 tests; build pass |
| `doerflow/repos/api` | focused `biome check` on auth/entitlement/wallet/Casbin/task/payment files | **PASS** — 17 files |
| `doerflow/repos/api` | `pnpm db:migrate:show; pnpm db:migrate` | **PASS** — wallet-link, Casbin and entitlement-adapter migrations applied |
| `doerflow/repos/admin` | local `rstest`; `NODE_ENV=production next build` | **PASS** — 2 tests; 17 routes built |
| `doerflow/repos/web` | local `rstest`; local `rsbuild build` | **PASS** — 5 tests; build pass |
| `doerflow/repos/shared` | local `rstest`; local `rslib build`; `tsc --noEmit` | **PASS** — 14 tests |
| `doerflow/repos/contracts` | `pnpm test`; `pnpm compile` | **PASS** — 10 tests; nothing pending |
| `doerflow/repos/wallet`, `worker` | local Jest | **PASS** — 1 platform error-semantics test each |
| `LuminaryWorks/docs` | `pnpm build` | **PASS** with existing Rspress CSR-fallback warnings |
| `doerflow/repos/docs` | local `rspress build` | **PASS** |

Repo-wide checks that remain red are outside touched rollout paths: API Biome formatting debt (41 diagnostics), admin drawer/i18n TypeScript debt, web `wagmi` non-empty-chain tuple typing, wallet/worker existing React/viem/`ox` typing, contracts Biome 1.x/2.x config mismatch, and four ecosystem JSON verifier findings in DataLuminary/BlockyEdu/VistaRemote. Rollout-focused files pass their checks.

### Rollout decision

| Mode | Decision | Gate |
|------|----------|------|
| `shadow_read` | **GO** | Deploy central + migrations, enable audit/diff metrics, keep local decision authoritative |
| canary `enforce` | **CONDITIONAL GO** | Only after live Logto callback/token, SIWE bind/replay and chain receipt/signing E2E succeed in the target environment |
| full `enforce` | **NO-GO today** | Requires clean shadow-diff soak and canary telemetry; this is an external environment/operations gate, not a remaining local implementation defect |
