# LuminaryWorks Helm (scaffold)

Charts exist so a **future** mapping from Compose profiles can start after Compose
combination delivery. They are **not** the current delivery path and are **not**
production-ready.

## Current path

Daily work and combination demos use **Compose only**:

- each product's own `deploy/` stack
- `deploy/scenarios/agent-commerce` / `smart-site`
- optional `deploy/scenarios/ingress` (HTTP hostname demo)

**Helm CLI is not required.** Do not install Helm to work on this repo. Kubernetes
is a later mapping, not a current gate. `pnpm helm:template` records a skip and
exits 0 when `helm` is missing.

## Gate (later)

Do not enable these charts in production until:

1. §11.1–§11.2 in `spec/composable-deployment.md` (Compose lab + one real scenario up)
2. Optionally §11.3 (backup / N-1) on the Compose path — still not a reason to switch to Helm

Fresh install, dependency fault, restart persistence, backup/restore and N-1
upgrade/rollback stay on Compose. Chart files being present does not mean accepted.

## Layout

| Chart | Role |
|---|---|
| `control-plane` / six product charts | Independent planes (no Deployments rendered yet) |
| `luminaryworks` | Umbrella: **only** `components.<product>.enabled` (plus `components.controlPlane.enabled`) |

`global` is limited to:

- domain
- image registry
- storageClass
- control-plane endpoints (identity / auth-gateway / entitlement)

**No shared database passwords** belong in `global`. Per-chart `database.external`,
`database.existingSecret`, `existingSecret`, `networkPolicy.enabled`,
`persistence.retain` and `migration.preUpgradeJob` are in each chart's
`values.schema.json`.

## Template (optional)

```bash
pnpm helm:template          # skip-ok when helm is missing
helm template doerflow deploy/helm/doerflow --dry-run
helm template luminaryworks deploy/helm/luminaryworks --dependency-update --dry-run
```
