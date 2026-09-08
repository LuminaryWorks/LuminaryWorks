# Object storage (AIStor Free, Hosted SaaS)

Self-hosted **S3-compatible** object storage for LuminaryWorks Hosted SaaS. Authority is the local data volume, not a public cloud.

Normative decisions: [`spec/decisions/2026-09-storage-doris-payment.md`](../../spec/decisions/2026-09-storage-doris-payment.md) (D-STOR-1, D-STOR-2, D-STOR-3).

This directory is **control-plane infrastructure**. Product repos are not modified here. Private/offline packs **must not** ship AIStor binaries or the license file.

## What this is

| Item | Value |
|---|---|
| Engine | Official [AIStor Free](https://www.min.io/legal/aistor-free-agreement) standalone (single node) |
| Image | `quay.io/minio/aistor/minio` — **digest- or `RELEASE.*`-pinned**, never `latest` |
| Forbidden | Old `minio/minio` Community Edition; Amazon S3 / Cloudflare R2 / GCS / OSS as the data plane |
| Topology | One named volume `object-storage-data`; no distributed cluster / HA |
| License | Operator-supplied file bind-mounted at `/minio.license` |
| Network | Joins `luminary-control-edge`; API and Console published on **loopback only** |
| Disk budget | 120 GiB **hard** cap via AIStor bucket quotas (sum ≤ 120). CDN does **not** reduce this |

AIStor Free has **no SLA**, no multi-node, no replication, and no lifecycle *transition*. Disclose single-node Pilot storage to customers.

## Enable (Hosted operator)

1. Obtain an AIStor Free license from MinIO (do not invent one; do not commit it).
2. Look up a **current** tag or digest on [Quay `minio/aistor/minio`](https://quay.io/repository/minio/aistor/minio?tab=tags) and the matching `mc` image. Replace the `REPLACE_WITH_CONFIRMED_QUAY_RELEASE_OR_DIGEST` placeholders. This repo does **not** ship a verified release pin. Never `latest`.
3. Copy `deploy/env/control-plane.env.example` → `control-plane.env` and fill every `AISTOR_*` secret. Product env files get **only** that product's access key, never `AISTOR_ROOT_*`.
4. Preflight (does not start containers, does not pull the image):

```bash
node scripts/preflight-object-storage.mjs --env-file deploy/env/control-plane.env
```

5. Start with the production overlay + profile:

```bash
docker compose --env-file deploy/env/control-plane.env \
  -f deploy/compose/control-plane.yaml \
  -f deploy/compose/control-plane.object-storage.yaml \
  --profile object-storage up -d
```

Missing license path, unpinned image, empty root user/password, or empty per-product keys fail Compose interpolation (`${VAR:?…}`) and the preflight script.

Default `pnpm cp:up` / offline `install.sh` **do not** enable this profile.

## Buckets and identities

Bootstrap (`object-storage-init`, idempotent) creates private buckets and one least-privilege user per bucket:

| Bucket | Identity | Typical consumer |
|---|---|---|
| `luminary-media` | platform key | Shared control-plane media |
| `dataluminary-media` | DataLuminary key | DataLuminary only |
| `blockyedu-media` | BlockyEdu key | BlockyEdu only |
| `vistaremote-recordings` | VistaRemote key | VistaRemote only |
| `vistacast-recordings` | VistaCast key | VistaCast only |
| `backup-staging` | operator key | Staging copies / migration |

Products address the API as `http://object-storage:9000` on `luminary-control-edge`. DoerFlow has no bucket in this work package. SyncroBrain reports stay in PostgreSQL / ThingsBoard until they actually emit object artifacts, so `syncrobrain-reports` is **not** created (the 120 GiB budget is already allocated).

`trial/` prefix: bootstrap tries `mc ilm rule add --expire-days 7` (expiration only). If Free omits ILM, that is a warning. **Product `trial.purge` remains authoritative.** Do not configure `--transition` or site/bucket replication on Free.

Default hard quotas (GiB; configurable, **sum must be ≤ 120**):

| Bucket | Default GiB |
|---|---|
| `vistaremote-recordings` | 40 |
| `vistacast-recordings` | 40 |
| `backup-staging` | 14 |
| `dataluminary-media` | 10 |
| `luminary-media` | 8 |
| `blockyedu-media` | 8 |

Bootstrap runs `mc quota set … --hard` (or the documented equivalent). If no supported quota command works, init **exits nonzero** — the 120 GiB budget is not optional.

## Watermarks (second guard)

**Hard enforcement** is the AIStor bucket quota above. Host watermarks are a **second** operator check for Trial admission, not a substitute for quota.

`df` on a Docker **named volume** often reports the **backing filesystem** (commonly all of `/var/lib/docker`), not isolated object-bytes in `object-storage-data`. Do not treat that number as bucket usage. Prefer `--used-bytes` from `mc du` / `mc quota info` when you have a live cluster.

| Used / 120 GiB budget | Product must |
|---|---|
| ≥ 70% | Stop **new** Trial recording |
| ≥ 80% | Stop **all** Trial object writes |
| ≥ 90% | Stop all **non-delete** object writes; alert |
| any | Deletes and trial purge stay allowed |

```bash
# Machine-readable JSON for cron / product admission (host operator, not an app container)
node scripts/object-storage-status.mjs --used-bytes 0
# Honest about df: only use --data-path if you know that path is a dedicated disk, not the Docker root FS
node scripts/object-storage-status.mjs --data-path /var/lib/docker/volumes/<project>_object-storage-data/_data
```

Contract: [`admission-contract.json`](admission-contract.json). Entitlement does **not** grow a storage-admission HTTP route in this work package. Products should honor bucket quota errors from S3 **and** this JSON before Trial recording / object PUT.

## CDN and origin

CDN **only** cuts origin bandwidth and latency. It **does not** shrink the 120 GiB budget.

- Origin is private: MinIO API `127.0.0.1:9000`, Console `127.0.0.1:9001` (SSH tunnel). No public bucket listing.
- Browser **upload**: short-lived presigned PUT (minutes). Browser **download / playback**: short-lived presigned GET or a signed cookie at the proxy.
- Public thumbnails only if the operator **explicitly** publishes a prefix (commented example in [`Caddyfile.example`](Caddyfile.example)). Default is private.
- TLS terminates at Caddy / the CDN; MinIO is not the public listener.

Example Caddy: [`Caddyfile.example`](Caddyfile.example). Same-host HTTP demo ingress (`deploy/scenarios/ingress/`) is **not** this origin.

## Migrate to a dedicated MinIO-compatible server

Application contract stays S3 `put` / `get` / `delete` / `head` / `presign` / `listPrefix`. Only the endpoint (and keys) change.

1. **Freeze writes** — set products to the 90% admission (or an operator flag): allow DELETE / purge only.
2. **Checksum copy** — `mc mirror` (or equivalent) from this node to the new endpoint. Verify object counts and ETag/checksums. AIStor Free has no site replication; copy is offline/one-shot.
3. **Endpoint switch** — point each product at the new S3 URL; keep the old volume read-only.
4. **Rollback** — switch the endpoint back to `http://object-storage:9000` (or the loopback origin). Do not delete the source volume until the verification window ends.

Keep `backup-staging` for staging copies. Customer-owned HA nodes need their own legal license or their own MinIO-compatible endpoint.

## Offline packs and private delivery

`scripts/pack-release.mjs` **does not** `docker save` AIStor. The control-plane pack may copy this overlay and docs so operators have the recipe; it must not copy `minio.license` or AIStor image tarballs.

Private customers: install and accept AIStor Free themselves, **or** set a MinIO-compatible endpoint in product env and leave `--profile object-storage` off.

## Compatibility assumptions (static vs live)

Verified without a license / without pulling images:

- Overlay YAML, required `${VAR:?}` secrets, loopback ports, limits, pack exclusion, watermark math, quota-sum cap, fail-closed attach/quota plan, docs links.

**Not** verified live on this machine (no license, no image pull):

- `mc ready local` inside `quay.io/minio/aistor/minio` (official Compose healthcheck).
- `quay.io/minio/aistor/mc` contains `/bin/sh` and `mc admin policy attach --user` / `mc quota set --hard` / `mc ilm rule add --expire-days`.
- License bind-mount actually starts the server.

If `mc` image has no shell, point `AISTOR_MC_IMAGE` at the same pinned **server** image (it ships `mc` for the healthcheck) or run bootstrap from the host `mc` binary you downloaded separately — never from a pack.
