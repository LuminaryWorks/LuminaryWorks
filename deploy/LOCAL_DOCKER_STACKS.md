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

## Product pointers

| Product | Core compose | Optional AI / heavy |
|---|---|---|
| LuminaryWorks control plane | `deploy/compose/control-plane.yaml` | `--profile ai` / `observability` — AI profile is the **gateway**, not an Ollama GPU host |
| VistaRemote | `deploy/compose/docker-compose.dev.yml` (postgres/redis) | `--profile ai` → lab `ollama` + qdrant + python-worker (**lab-only**; host Ollama port often `11435`) |
| VistaCast | `deploy/docker-compose.yml` | Demo RTSP/RTMP publishers on separate profiles; edge infer on client, not server GPU |
| Identity | See `identity/LOCAL_DEV_DOCKER.md` | — |

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
```
