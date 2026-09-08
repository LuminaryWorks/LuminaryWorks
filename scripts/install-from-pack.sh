#!/usr/bin/env bash
# Install a LuminaryWorks offline pack on a Linux host.
#
#   sudo bash install.sh --public-host 192.168.64.3
#
# Requires Docker Engine + Compose plugin. Does not build images and does not
# call the internet if the pack's images were already loaded.
set -euo pipefail

PACK_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_HOST=""
BIND_ADDR="0.0.0.0"
PROTOCOL="http"

usage() {
  cat <<'EOF'
Usage: install.sh --public-host <ip-or-dns> [--bind-addr 0.0.0.0] [--protocol http]

Loads images/control-plane.tar, writes deploy/env/control-plane.env if missing,
then docker compose up -d --no-build --pull never.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-host)
      PUBLIC_HOST="$2"
      shift 2
      ;;
    --bind-addr)
      BIND_ADDR="$2"
      shift 2
      ;;
    --protocol)
      PROTOCOL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

if [[ -z "$PUBLIC_HOST" ]]; then
  echo "missing --public-host (browser-reachable IP or DNS name)" >&2
  exit 64
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Run scripts/remote-host-bootstrap.sh first." >&2
  exit 78
fi

cd "$PACK_DIR"

IMAGE_TAR="$PACK_DIR/images/control-plane.tar"
if [[ ! -f "$IMAGE_TAR" ]]; then
  echo "missing $IMAGE_TAR" >&2
  exit 78
fi

echo "[install] docker load $IMAGE_TAR"
docker load -i "$IMAGE_TAR"

ENV_FILE="$PACK_DIR/deploy/env/control-plane.env"
EXAMPLE="$PACK_DIR/deploy/env/control-plane.env.example"
mkdir -p "$PACK_DIR/deploy/env"
chmod 700 "$PACK_DIR/deploy/env"

# Same Compose project name reuses volumes — keep existing DB passwords.
HOST_ENV="${HOME}/luminaryworks/deploy/env/control-plane.env"
if [[ -f "$HOST_ENV" && ! -f "$ENV_FILE" ]]; then
  cp "$HOST_ENV" "$ENV_FILE"
  echo "[install] reused $HOST_ENV"
fi

python3 - "$EXAMPLE" "$ENV_FILE" "$PUBLIC_HOST" "$BIND_ADDR" "$PROTOCOL" <<'PY'
import secrets, sys
from pathlib import Path

example, dest, public_host, bind_addr, protocol = sys.argv[1:6]
existing = {}
dest_path = Path(dest)
if dest_path.exists():
    for raw in dest_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        existing[k.strip()] = v.strip().strip('"').strip("'")

host = public_host.rstrip("/")
if host.startswith("http://") or host.startswith("https://"):
    base = host
else:
    base = f"{protocol}://{host}"
identity = f"{base}:3001"
forced = {
    "CONTROL_PLANE_BIND_ADDR": bind_addr,
    "CONTROL_PLANE_ADMIN_BIND_ADDR": "127.0.0.1",
    "IDENTITY_ENDPOINT": identity,
    "IDENTITY_ADMIN_ENDPOINT": "http://127.0.0.1:3002",
    "AUTH_GATEWAY_PUBLIC_URL": f"{base}:3010",
    "ENTITLEMENT_OIDC_ISSUER": f"{identity}/oidc",
}
secret_keys = [
    "IDENTITY_DB_PASSWORD",
    "ENTITLEMENT_DB_PASSWORD",
    "ENTITLEMENT_SERVICE_API_KEY",
    "ENTITLEMENT_PARTNER_SECRET_PEPPER",
    "ENTITLEMENT_PARTNER_TOKEN_SECRET",
    "AI_VAULT_MASTER_KEY",
]
secrets_out = {}
for key in secret_keys:
    prev = existing.get(key) or ""
    secrets_out[key] = prev if prev else secrets.token_hex(32)

out = []
for raw in Path(example).read_text(encoding="utf-8").splitlines():
    stripped = raw.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        out.append(raw)
        continue
    key = stripped.split("=", 1)[0].strip()
    if key in forced:
        out.append(f"{key}={forced[key]}")
    elif key in secrets_out:
        out.append(f"{key}={secrets_out[key]}")
    else:
        out.append(raw)
Path(dest).write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"wrote {dest}")
PY
chmod 600 "$ENV_FILE"

echo "[install] docker compose up (no build, no pull)"
docker compose --env-file "$ENV_FILE" -f "$PACK_DIR/deploy/compose/control-plane.yaml" \
  up -d --no-build --pull never

echo "[install] control-plane started."
echo "  OIDC:     ${PROTOCOL}://${PUBLIC_HOST}:3001/oidc"
echo "  Gateway:  ${PROTOCOL}://${PUBLIC_HOST}:3010/ready"
echo "  Entitlement: ${PROTOCOL}://${PUBLIC_HOST}:3040/ready"
echo "  Logto Admin: ssh -L 3002:127.0.0.1:3002 USER@${PUBLIC_HOST}  then http://127.0.0.1:3002"
echo "  Operator passwords: see deploy/OPERATOR.md (LW_LOGTO_ADMIN_* vs ACCOUNTS.*.env)"
echo "  Object storage: NOT started. AIStor is not in this pack. See deploy/object-storage/README.md"
