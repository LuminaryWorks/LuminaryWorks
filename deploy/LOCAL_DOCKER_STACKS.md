# Local Docker stacks (developer laptop)

Cheat sheet for idle-safe local Compose across LuminaryWorks products. Normative sidecar rules: `.cursor/rules/local-docker-sidecars.mdc`. AI hosting: `.cursor/rules/ai-hosting-policy.mdc` · [spec/ai-platform.md](../spec/ai-platform.md) D-AI-9.

## Principles

1. Default `docker compose up` = **core only** (API / DB / Redis / product web as documented).
2. Heavy or optional services use **Compose profiles** (or a named overlay).
3. Demo publishers / generators: `restart: on-failure:N` or `restart: "no"` — not infinite `unless-stopped` on failing lab jobs.
4. **Ollama / vLLM are not default sidecars.** Lab-only under an `ai` (or equivalent) profile. Early-stage products call **cloud LLM APIs** (DeepSeek / OpenAI / BYOK). Do not treat product-server Ollama as production.

## Stop vs destroy

| Action | Effect |
|---|---|
| `docker compose stop` | Containers stop; Docker Desktop reboot may revive `unless-stopped` containers that still exist |
| `docker compose down` | Removes containers; volumes may remain |
| `docker compose down -v` | Also removes named volumes (data loss) |

## Platform stack (`luminary-works`)

Early stage: **one** Compose project `luminary-works` (`CONTROL_PLANE_PROJECT`), **one** Postgres (`control-plane-db` → fixed volume `luminary_works_pg`), **one** Redis (`identity-redis`). Logical DBs: `logto`, `entitlement`, `notification`, `ai_platform`. Local loopback `5433` / Redis `6381` via `control-plane.dev-ports.yaml` (`pnpm ent:up` / `pnpm id:up`).

Product Postgres containers stay on their own ports. Do not merge six product planes into this project.

`identity/docker-compose.yml` is **standalone-only** (`--profile standalone-db`). Default `pnpm id:up` starts Identity from the control-plane compose. See `deploy/OPERATOR.md` §5.4–§5.5.

### Entitlement Docker sidecar (all products)

Central Entitlement is a **Docker service** (`:3040`), not a per-product host Nest process.

| Audience | Command | What starts |
|---|---|---|
| **Product developers** (DataLuminary, BlockyEdu, DoerFlow, VistaRemote, VistaCast, SyncroBrain) | From the product MetaRepo: `pnpm ent:sidecar` | Minimal slice: `control-plane-db` + `identity-redis` + `identity` + `entitlement` |
| Shared DB only | `pnpm ent:up` (LuminaryWorks) | Postgres only — **not** the Entitlement API |
| Entitlement **source** changes | `pnpm ent:dev` (LuminaryWorks) | Host Nest against shared DB |

Products must **not** vendor a second Entitlement compose. Delegates are synced with `pnpm sync:ent-sidecar` from LuminaryWorks. Override sibling path with `LUMINARYWORKS_ROOT`.

```bash
# From any product MetaRepo (sibling clone of LuminaryWorks required)
pnpm ent:sidecar
curl -fsS http://127.0.0.1:3040/ready

# Product .env when exercising commerce / membership / legal
# ENTITLEMENT_MODE=shadow_read
# ENTITLEMENT_BASE_URL=http://localhost:3040
# ENTITLEMENT_SERVICE_API_KEY=<same as deploy/env/control-plane.env>
```

Default product mode remains `ENTITLEMENT_MODE=off` (no central calls). Do not leave the sidecar in default `docker compose up` for product cores.

## Product pointers

| Product | Core compose | Optional AI / heavy |
|---|---|---|
| LuminaryWorks control plane | `deploy/compose/control-plane.yaml` | `--profile ai` / `observability` — AI profile is the **gateway**, not an Ollama GPU host |
| VistaRemote | `deploy/compose/docker-compose.dev.yml` (postgres/redis) | `--profile ai` → lab `ollama` + qdrant + python-worker (**lab-only**; host Ollama port often `11435`) |
| VistaCast | `deploy/docker-compose.yml` | Demo RTSP/RTMP publishers on separate profiles; edge infer on client, not server GPU |
| Identity / control plane | `deploy/compose/control-plane.yaml` (project `luminary-works`) | Identity alone: `identity/` + `--profile standalone-db` |
| Entitlement (product opt-in) | same compose; `pnpm ent:sidecar` | Minimal services only — not full `cp:up` |

## VistaRemote lab AI (optional)

```bash
# Core only (default bootstrap)
docker compose -f deploy/compose/docker-compose.dev.yml up -d

# Lab offline LLM — not for production servers
docker compose -f deploy/compose/docker-compose.dev.yml --profile ai up -d
```

Production / early SaaS: configure `LUMINARY_AI_*` or `DEEPSEEK_*` on the `ai` Worker. Do not require Ollama on the Nest host.

## Re-sync rules

```bash
pnpm sync:cursor-local-docker-rule   # sidecar profiles
pnpm sync:cursor-ai-hosting          # cloud API + edge; no early server LLM
pnpm sync:ent-sidecar                # product MetaRepo ent:sidecar delegates
```
