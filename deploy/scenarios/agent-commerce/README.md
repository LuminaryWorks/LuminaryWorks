# agent-commerce scenario pack

Independent Compose projects for the **VistaCast → SyncroBrain → DoerFlow** commerce loop.

This pack **does not** merge product Compose files into one project. Each product keeps its own project name, volumes and business database. The optional LuminaryWorks control plane is a separate project (`lw-control`).

Normative architecture: [`spec/composable-deployment.md`](../../../spec/composable-deployment.md). Manifest: [`deploy/manifests/agent-commerce.dev.json`](../../manifests/agent-commerce.dev.json).

## Projects (in start order)

| Compose project | Product / plane | Required | Compose files (in the product repo) |
|---|---|---|---|
| `lw-control` | LuminaryWorks Identity + Auth Gateway + Entitlement | **optional** | `LuminaryWorks/deploy/compose/control-plane.yaml` |
| `lw-vistacast` | VistaCast | yes | `deploy/docker-compose.yml` + `docker-compose.dev.yml` (or `core.yml` + `dev.yml` when that split exists) |
| `lw-syncrobrain` | SyncroBrain | yes | `deploy/docker-compose.core.yml` + `docker-compose.dev.yml` |
| `lw-doerflow` | DoerFlow | yes | `deploy/docker-compose.core.yml` + `docker-compose.dev.yml` |

Product paths are **not** vendored here. Resolution order:

1. `PRODUCT_ROOTS` — `vistacast=/abs/VistaCast,doerflow=/abs/DoerFlow` or a JSON object
2. Sibling of this MetaRepo (`../VistaCast` from the repo root). From this directory that is `../../../VistaCast`.

Preflight **fails** when a required product's Compose files are missing and names the product.

## Bring up

```bash
# from LuminaryWorks repo root — generate gitignored env + HMAC once
pnpm peers:init -- --scenario agent-commerce

# no containers started
pnpm preflight:scenario -- --scenario agent-commerce

# optional control plane first, then each product project
pnpm scenario:up -- agent-commerce --with-control-plane

# or dry-run the independent docker compose commands
node scripts/scenario-up.mjs agent-commerce --dry-run
```

Copy HMAC values from `peers.secrets.env` into **each product's** gitignored env
(VistaCast `deploy/.env`, SyncroBrain `deploy/.env.prod` / control-plane overlay,
DoerFlow `deploy/env/api.env`). Do not point all six products at one shared `.env`.

Container-to-container Inbox URLs use Docker DNS on `luminary-control-edge`
(`peers.env.example`). Daily laptop / browsers use `HOST_*` ports. Same-host demo
hostname routing is optional: [`../ingress/`](../ingress/) (HTTP, not Let's Encrypt).


`smart-site` reuses these project names. Do not `up` a second control plane or a second copy of VistaCast / SyncroBrain / DoerFlow databases.

When `--with-control-plane` is set, a product's own `docker-compose.control-plane.yml` overlay is attached **if that file exists**. Those overlays only join the shared edge network; they must not start Identity or Entitlement. Point the product overlay at `CONTROL_PLANE_EDGE_NETWORK=luminary-control-edge` (DoerFlow: `DOERFLOW_CONTROL_PLANE_NETWORK`; DataLuminary: `CONTROL_PLANE_NETWORK`) — defaults in the product repos may still use a private network name.

## Frozen contract

Senders live in the product repos. This MetaRepo only publishes the envelope; see [`../contracts/`](../contracts/).

| Concern | Rule |
|---|---|
| Events | CloudEvents 1.0 + HMAC (`X-DoerFlow-Signature: sha256=…`, timestamp + nonce). Secret is **per peer**. |
| M2M | Logto `client_credentials`; audience `https://api.doerflow.local`; scopes `integration.provider.register` `integration.event.submit` `integration.callback.read`. No redirect URI. |
| Jobs | `authorize` reserves budget (no payee credit) → provider 2xx + output hash → `capture`; 5xx/timeout → `void`. |
| Callbacks | Signed CloudEvents. **Must not** ack / resolve / close the source alert or Incident, and **must not** execute device RPC. |
| AuthN errors | `401` identity · `402` / `ENTITLEMENT_*` commercial · `403` Casbin resource ACL. Never collapse 402 into 403. |

`ai=central` is lab-only. Preflight refuses it for `pilot` / `production` manifests.

## Honesty

This pack only orchestrates. It does not implement VistaCast / SyncroBrain / DoerFlow senders, and it does not merge their Compose files. If a required product repo or Compose set is missing, preflight fails and names the product. `ai=central` remains lab-only.
