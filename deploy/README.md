# LuminaryWorks deploy

Optional shared control plane and reference Control Manifests for the federated six-product suite. Normative architecture: [`spec/composable-deployment.md`](../spec/composable-deployment.md).

The control plane is **optional**. Every product ships and runs standalone with `identity=external_oidc|local`, `entitlement=off|offline_license`, `ai=off|local_byok`. Nothing here creates a shared business database, a shared Casbin policy or a shared release train.

## Layout

| Path | Purpose |
|---|---|
| `compose/control-plane.yaml` | Identity + Auth Gateway + Entitlement core; `ai` and `observability` opt-in profiles |
| `compose/control-plane.dev-ports.yaml` | Local-only override publishing datastore ports |
| `env/control-plane.env.example` | Every variable; copy to `env/control-plane.env` (git-ignored) and fill in |
| `manifests/*.json` | Reference Control Manifests, one per deployment profile |
| `observability/otel-collector.yaml` | Collector config for the `observability` profile |
| `scenarios/agent-commerce/` | Independent Compose projects: optional `lw-control` + VistaCast + SyncroBrain + DoerFlow |
| `scenarios/smart-site/` | Incremental overlay: agent-commerce + VistaRemote + DataLuminary + BlockyEdu (training) |
| `scenarios/contracts/` | Cross-scenario JSON Schema / CloudEvents samples (UTF-8 no BOM). Product senders are **not** in this repo. |
| `scenarios/ingress/` | Optional same-host HTTP Caddy by hostname. Not Let's Encrypt. Daily work uses per-product host ports. |
| `helm/` | Per-product chart **skeletons** + umbrella. Not required. Not production. K8s is future. |

## Quick start

```bash
cp deploy/env/control-plane.env.example deploy/env/control-plane.env
# fill in IDENTITY_DB_PASSWORD, ENTITLEMENT_DB_PASSWORD, ENTITLEMENT_SERVICE_API_KEY, …
#   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

pnpm preflight:control-plane                       # manifest + Compose contract, no containers started
docker compose --env-file deploy/env/control-plane.env \
  -f deploy/compose/control-plane.yaml up -d

pnpm --dir identity exec node scripts/probe-readiness.mjs   # or: node identity/scripts/probe-readiness.mjs
```

Optional profiles:

```bash
docker compose --env-file deploy/env/control-plane.env \
  -f deploy/compose/control-plane.yaml --profile ai --profile observability up -d
```

## Preflight

```bash
node scripts/preflight-control-plane.mjs --manifest deploy/manifests/smart-site.dev.json
node scripts/preflight-control-plane.mjs --stage production --strict
```

Two independent gates, neither of which starts a container:

1. **Control Manifest** — [`@luminaryworks/control-manifest`](../shared/packages/control-manifest/README.md) validates profile, capability modes, contract versions, degradation and the absence of secrets. Requires `pnpm shared:build` (or a build of that one package) beforehand.
2. **Compose contract** — checks over `docker compose config` output: no fixed `container_name`, no `host.docker.internal`, no host-port conflicts, no generic service names that would merge across products, no weak default secrets, no published datastore ports in a hardened stage, no floating production image tags.

`--strict` also fails when Docker is unavailable, so CI cannot silently skip gate 2.

## Relationship to the standalone stacks

`identity/docker-compose.yml` and `services/entitlement/docker-compose.yml` stay as they are and remain independently runnable — they keep their own project names, fixed volume names and single-service dev defaults. `compose/control-plane.yaml` is a **separate** Compose project that reuses the same images with composition-safe settings (no `container_name`, no committed secrets, no datastore host ports, project-scoped volumes).

Pick one at a time: running both against the same host ports will conflict. Use `CONTROL_PLANE_BIND_ADDR` / the port variables to move the control plane if you need both.

Product Compose projects reach the control plane by joining its edge network:

```yaml
networks:
  luminary-control-edge:
    external: true
```

…then address services as `http://identity:3001/oidc`, `http://auth-gateway:3010`, `http://entitlement:3040`. Never `host.docker.internal`.

## health / ready / version

| Service | health | ready | version |
|---|---|---|---|
| Identity (Logto) | container healthcheck on OIDC discovery | `identity/scripts/probe-readiness.mjs` (discovery + non-empty JWKS) | not exposed by Logto — pinned in the manifest |
| Auth Gateway | `GET /health` (liveness only) | `GET /ready` → 503 when upstream discovery fails | `GET /version` |
| Entitlement | `GET /health` | `GET /ready` → 503 when the database is unreachable | `GET /version` |
| AI Platform | `GET /v1/health` (liveness only) | **not implemented** | **not implemented** |

## AI Platform status

`ai=central` is **not hardened**: the AI Platform has no AuthN, no Entitlement enforcement and only in-memory metering. Preflight therefore refuses `ai=central` for `pilot`/`production` manifests; those deployments use `ai=off` or `ai=local_byok`. The `ai` Compose profile exists for dev and lab work only.

## Scenario packs

`agent-commerce` and `smart-site` orchestrate **separate Compose projects**. They never merge six-product Compose files into one project.

```bash
pnpm peers:init -- --scenario agent-commerce   # gitignored env + HMAC secrets (once)
pnpm preflight:scenario -- --scenario agent-commerce
pnpm scenario:up -- agent-commerce --dry-run
pnpm scenario:up -- smart-site --with-control-plane
```

Inbox URLs (Docker DNS vs host ports) live in `scenarios/agent-commerce/peers.env.example`.
Secrets stay in `peers.secrets.env` (gitignored) and are **copied into each product env** —
never one shared `.env` for six products. Combination traffic uses `luminary-control-edge`
service names (`doerflow-api`, `iot-gateway`, `api`), never `host.docker.internal`.

Same-machine browsers: daily = published host ports; demo hostname layer =
`scenarios/ingress/` (HTTP only, not TLS).


Product Compose files live in sibling repos (`../DoerFlow`, …). Override with `PRODUCT_ROOTS`. Missing required Compose files fail preflight and name the product. `docker compose config` is **not** run on those files here — only this repo's control-plane stack is checked by `pnpm preflight:control-plane`.

`smart-site` extends `agent-commerce` (same project names) so the control plane and business databases are not deployed twice. BlockyEdu is a training entry (`required: false`). Remote sessions need a human to open a VistaRemote deep link; callbacks do not auto-resolve, close, or RPC. DataLuminary is observation / embed only.

Cross-scenario envelopes: [`scenarios/contracts/`](scenarios/contracts/).

## Helm

Scaffolds under [`helm/`](helm/). **Current delivery is Compose.** Helm CLI is not
required; `pnpm helm:template` skips when `helm` is missing. Do not enable charts
in production until §11.2 combination delivery has passed. Backup / N-1 / six-product
full-stack up are §11.3 later gates, not a reason to install Helm
(`spec/composable-deployment.md` §11–§12).

## Not yet covered

- Per-product standalone Compose contracts (`dev` / `prod` / `external-db` / `control-plane` / `smoke` overlays) live in each product repo. Scenario preflight resolves those files and fails by product name when a required set is missing.
- Combination runtime (`scenario:up` without `--dry-run`) is a §11.2 deliverable, not a daily gate.
- Private/SaaS hardening still open: six-product simultaneous up, backup/restore, N-1 (`spec/composable-deployment.md` §11.3). Helm production enablement waits on Compose combination, not on that list.
