# Remote deploy (SSH + CI)

One path for a private host (UTM / customer LAN) and a public SaaS host (Hetzner).
Current runtime is **Compose**, not Helm. **Customers:** [`../HANDBOOK.md`](../HANDBOOK.md). Lab notes: [`../OPERATOR.md`](../OPERATOR.md).
See [`spec/composable-deployment.md`](../../spec/composable-deployment.md).

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

After that, from this MetaRepo:

```bash
# key-only SSH; never commit the private key or host passwords
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

Workflow: [`.github/workflows/deploy-remote.yml`](../../.github/workflows/deploy-remote.yml) (`workflow_dispatch` only).

Repository secrets:

| Secret | Purpose |
|---|---|
| `DEPLOY_HOST` | SSH hostname / public IP |
| `DEPLOY_USER` | SSH user in the `docker` group |
| `DEPLOY_SSH_KEY` | Private key whose public half is in `~/.ssh/authorized_keys` |

A **LAN UTM VM is not reachable from `ubuntu-latest`**. For private networks either:

- run `remote-deploy.mjs` from a laptop on that LAN, or
- install a GitHub **self-hosted runner** on the VM and point the workflow `runs-on` at that runner.

Bootstrap probes official Docker Hub first (`--registry-mirror auto`, the default). If `registry-1.docker.io` is blocked, it writes `https://docker.m.daocloud.io`. Offline packs do not need Hub. Skip with `--registry-mirror none`.

Hetzner (tomorrow): create an A record or use the public IPv4, put the same three secrets in the repo, then Run workflow → `control-plane`.

## Honesty

- Combination `agent-commerce` / `smart-site` still depends on each product repo's own Compose files (`spec` §11.2). Missing files fail preflight by product name.
- `ai=central` stays lab-only.
- Object storage (`--profile object-storage`) is **not** started by default and is **not** inside offline packs. Enabling it without `AISTOR_LICENSE_FILE`, a pinned `quay.io/minio/aistor/minio` image, root credentials, and per-product keys fails preflight/Compose. See [`../object-storage/README.md`](../object-storage/README.md).
- Do not reuse one `.env` across six products. Host `control-plane.env` is control-plane only.
