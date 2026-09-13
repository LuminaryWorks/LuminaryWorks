# Remote deploy (SSH + CI)

One path for a private host (UTM / customer LAN) and a public SaaS host (OVH / Hetzner).
Current runtime is **Compose**, not Helm. **Customers:** [`../HANDBOOK.md`](../HANDBOOK.md). Lab notes: [`../OPERATOR.md`](../OPERATOR.md).
See [`spec/composable-deployment.md`](../../spec/composable-deployment.md).

## Personal OVH (do this)

This README is the **air-gap / offline image** path (`pack-release.mjs` / `pnpm pack:control-plane` / `pnpm pack:all`). It is **not** `pnpm pack:luminaryworks` (source kit, host builds). See [`../README.md`](../README.md) "Two pack commands" and [`../HANDBOOK.md`](../HANDBOOK.md) §4.

Pack on the laptop, SSH the tar, never compile on the VPS, never burn GitHub-hosted minutes:

```bash
node scripts/pack-release.mjs --target control-plane --platform linux/amd64
node scripts/remote-deploy.mjs \
  --host 203.0.113.10 \
  --user debian \
  --key ~/.ssh/id_ed25519_lw_ovh \
  --pack dist/packs/luminaryworks-control-plane-linux-amd64-<sha>.tar \
  --public-host 203.0.113.10
```

`install.sh` on the host is **bash**. The laptop orchestrator stays **Node** (`remote-deploy.mjs`) because it already shares SSH helpers, env rendering, and probes with the rest of this MetaRepo. Do not rewrite it in Python.

GitHub `ubuntu-latest` + `docker compose up --build` is **refused** unless `ALLOW_REMOTE_COMPOSE_BUILD=1`.

## What this deploys

| `--target` | Meaning | Needs sibling product repos |
|---|---|---|
| `control-plane` | Identity (Logto) + Auth Gateway + Entitlement | no |
| `agent-commerce` | optional control plane + VistaCast + SyncroBrain + DoerFlow | yes |
| `smart-site` | overlay: VistaRemote + DataLuminary (+ BlockyEdu training) | yes |

SaaS vs private is **the same Compose**. Change env, not charts:

- **Lab / private LAN**: `http://<lan-ip>:3001`, `CONTROL_PLANE_BIND_ADDR=0.0.0.0`, Logto admin stays on `127.0.0.1` (SSH tunnel).
- **Public SaaS**: put Caddy / another TLS proxy in front; set `DEPLOY_PROTOCOL=https` and `--public-host id.example.com` once DNS exists. `deploy/scenarios/ingress/` is HTTP demo only, not Let's Encrypt.

## Laptop → host (SSH)

First boot of a stock Debian/Ubuntu VM (no sudo, no Docker) — copy the bootstrap script and run it as root once:

```bash
scp scripts/remote-host-bootstrap.sh USER@HOST:/tmp/lw-bootstrap.sh
ssh USER@HOST 'su -c "bash /tmp/lw-bootstrap.sh --user USER"'
```

After that, from this MetaRepo **prefer an offline pack** (no compile on the host):

```bash
# key-only SSH; never commit the private key or host passwords
node scripts/pack-release.mjs --target control-plane --platform linux/amd64
node scripts/remote-deploy.mjs \
  --host 192.168.64.3 \
  --user andy \
  --key ~/.ssh/id_ed25519_lw_lab \
  --pack dist/packs/luminaryworks-control-plane-linux-arm64-<sha>.tar
```

Lab-only fallback (rsync + `compose --build` on the host — not for OVH SaaS):

```bash
node scripts/remote-deploy.mjs \
  --host 192.168.64.3 \
  --user andy \
  --key ~/.ssh/id_ed25519_lw_lab \
  --target control-plane
```

`remote-deploy.mjs` will:

1. Install Docker Engine + Compose if missing (`scripts/remote-host-bootstrap.sh`)
2. `rsync` this repo (excludes `node_modules`, `.git`, secrets)
3. Create `deploy/env/control-plane.env` on the **host** if missing (keeps existing secrets)
4. `docker compose up -d --build`
5. Probe `/health` `/ready` `/version` from the laptop

Logto admin: `ssh -L 3002:127.0.0.1:3002 USER@HOST` then open `http://127.0.0.1:3002`.

## GitHub Actions

Workflow: [`.github/workflows/deploy-remote.yml`](../../.github/workflows/deploy-remote.yml).

Personal OVH **must not** use `ubuntu-latest` to rsync + `compose --build`. The script refuses that unless `ALLOW_REMOTE_COMPOSE_BUILD=1`. Pack on the laptop and `--pack`.

A **LAN UTM VM is not reachable from `ubuntu-latest`**. For private networks run `remote-deploy.mjs` from a laptop on that LAN.

## Honesty

- Combination `agent-commerce` / `smart-site` still depends on each product repo's own Compose files (`spec` §11.2). Missing files fail preflight by product name.
- `ai=central` stays lab-only.
- Object storage (`--profile object-storage`) is **not** started by default and is **not** inside offline packs. Enabling it without `AISTOR_LICENSE_FILE`, a pinned `quay.io/minio/aistor/minio` image, root credentials, and per-product keys fails preflight/Compose. See [`../object-storage/README.md`](../object-storage/README.md).
- Do not reuse one `.env` across six products. Host `control-plane.env` is control-plane only.
