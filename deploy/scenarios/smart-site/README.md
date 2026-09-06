# smart-site scenario pack

Incremental overlay on [`../agent-commerce/`](../agent-commerce/). Adds VistaRemote (human remote), DataLuminary (observe / embed) and BlockyEdu (training links only).

**Not a replacement.** The same Compose project names (`lw-control`, `lw-vistacast`, `lw-syncrobrain`, `lw-doerflow`) are reused so the control plane and business databases are not deployed twice.

Manifest: [`deploy/manifests/smart-site.dev.json`](../../manifests/smart-site.dev.json). BlockyEdu `required` is `false` in the Control Manifest and in this pack.

## Incremental projects

Start **agent-commerce first** (or let `scenario-up smart-site` bring those projects up under the same names), then:

| Compose project | Product | Required | Role |
|---|---|---|---|
| `lw-vistaremote` | VistaRemote | yes | Human-authorized remote session (deep link) |
| `lw-dataluminary` | DataLuminary | no | REST export / embed observer — **not** Safety or settlement |
| `lw-blockyedu` | BlockyEdu (VibeLearn `deploy/edu`) | no | Playbook / course **links** only |

Compose paths follow the same `PRODUCT_ROOTS` / `../../../<ProductDir>` convention as agent-commerce. DataLuminary uses `deploy/standalone/compose.core.yml` + `compose.db.yml` + `compose.dev.yml`. VistaRemote uses `deploy/compose/docker-compose.core.yml` + `docker-compose.dev.yml`. BlockyEdu uses `deploy/edu/docker-compose.yml` + `docker-compose.dev.yml`.

## Flow

```text
VistaCast alert.v1
    → SyncroBrain Incident / WorkOrder
    → DoerFlow paid Task (authorize → capture | void)
    → VistaRemote deep link (human confirms the session)
    → signed callback (evidence only)
    → DataLuminary export / embed
```

Hard rules:

- Remote control **requires a human** to open the deep link. APIs never start a session, never hold RTSP / MQTT / ThingsBoard / TURN credentials, and `autoRemoteControl` is constantly `false`.
- Callbacks **do not** auto-resolve, close, ack, capture, or issue device RPC.
- BlockyEdu contributes `{playbook,course}` URLs. The browser **must not** hold device credentials.
- DataLuminary consumes REST export / embed. It is **not** the Safety Kernel, DoerFlow ledger, or source-alert authority.

## Bring up

```bash
pnpm peers:init -- --scenario smart-site
pnpm preflight:scenario -- --scenario smart-site
pnpm scenario:up -- smart-site --with-control-plane
```

Preflight fails if `agent-commerce/projects.json` is missing (`smart_site_requires_agent_commerce`) or if a required product Compose file is absent.

Embed origins are an allowlist (`DATALUMINARY_EMBED_ORIGINS` in `env.example`). MQTT stays on two planes: device telemetry (`v1/devices/me/telemetry`) vs cross-product events (`lw/v1/{tenantId}/{sourceProduct}/{schemaVersion}`). See [`../contracts/`](../contracts/).
