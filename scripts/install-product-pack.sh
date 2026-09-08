#!/usr/bin/env bash
# Install a *product* offline pack on a Linux host.
#
#   sudo bash install.sh --public-host 192.168.64.3
#
# Requires Docker Engine + Compose plugin. Does not build images.
set -euo pipefail

PACK_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_HOST=""
BIND_ADDR="0.0.0.0"
PROTOCOL="http"

usage() {
  cat <<'EOF'
Usage: install.sh --public-host <ip-or-dns> [--bind-addr 0.0.0.0] [--protocol http]

Loads images/*.tar, copies missing env from *.example, then
docker compose up -d --no-build --pull never for this product only.
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

if [[ ! -f "$PACK_DIR/MANIFEST.json" ]]; then
  echo "missing $PACK_DIR/MANIFEST.json" >&2
  exit 78
fi

cd "$PACK_DIR"

shopt -s nullglob
for tar in images/*.tar; do
  echo "[install] docker load $tar"
  docker load -i "$tar"
done
shopt -u nullglob

# Promote *.example → live files once (never overwrite).
while IFS= read -r -d '' example; do
  dest="${example%.example}"
  if [[ ! -f "$dest" ]]; then
    mkdir -p "$(dirname "$dest")"
    cp "$example" "$dest"
    echo "[install] seeded $dest from example — edit secrets before production"
  fi
done < <(find . -name '*.example' -print0 2>/dev/null || true)

python3 - "$PACK_DIR" <<'PY'
import re
import secrets
import sys
from pathlib import Path

root = Path(sys.argv[1])
secret_keys = ("_SECRET", "_PASSWORD", "_KEY")

def fill_env(path: Path) -> None:
    if not path.is_file():
        return
    lines = path.read_text(encoding="utf-8").splitlines()
    out = []
    changed = False
    for raw in lines:
        stripped = raw.strip()
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", stripped)
        if not m or stripped.startswith("#"):
            out.append(raw)
            continue
        key, val = m.group(1), m.group(2)
        empty = val.strip().strip('"').strip("'") in ("", "change-me", "CHANGE_ME")
        if empty and (key.endswith(secret_keys) or key == "POSTGRES_PASSWORD"):
            out.append(f"{key}={secrets.token_hex(24)}")
            changed = True
        else:
            out.append(raw)
    if changed:
        path.write_text("\n".join(out) + "\n", encoding="utf-8")
        print(f"[install] filled empty secrets in {path}")

for env_path in root.rglob("*.env"):
    if env_path.name.endswith(".example"):
        continue
    fill_env(env_path)

db = root / "deploy" / "env" / "db.env"
dot = root / ".env"
if db.is_file():
    pw = ""
    for line in db.read_text(encoding="utf-8").splitlines():
        if line.startswith("POSTGRES_PASSWORD="):
            pw = line.split("=", 1)[1].strip().strip('"').strip("'")
            break
    if pw:
        existing = dot.read_text(encoding="utf-8") if dot.exists() else ""
        if "POSTGRES_PASSWORD=" not in existing:
            with dot.open("a", encoding="utf-8") as fh:
                fh.write(f"POSTGRES_PASSWORD={pw}\n")
            print("[install] wrote POSTGRES_PASSWORD into .env for Compose interpolation")
PY

# shellcheck disable=SC2016
eval "$(python3 - "$PACK_DIR/MANIFEST.json" "$PUBLIC_HOST" "$BIND_ADDR" "$PROTOCOL" <<'PY'
import json, sys
from pathlib import Path
manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
project = manifest.get("project") or f"lw-{manifest.get('target', 'product')}"
files = manifest.get("compose") or []
print(f"PROJECT={project}")
print("COMPOSE_FILES=(")
for f in files:
    print(f"  {f!r}")
print(")")
print(f"PACK_PUBLIC_HOST={sys.argv[2]!r}")
print(f"PACK_BIND_ADDR={sys.argv[3]!r}")
print(f"PACK_PROTOCOL={sys.argv[4]!r}")
PY
)"

if [[ ${#COMPOSE_FILES[@]} -eq 0 ]]; then
  echo "MANIFEST.json has no compose files" >&2
  exit 78
fi

args=(--project-name "$PROJECT" --project-directory "$PACK_DIR")
for f in "${COMPOSE_FILES[@]}"; do
  args+=(-f "$PACK_DIR/$f")
done

echo "[install] docker compose up (no build, no pull) project=$PROJECT"
echo "[install] public-host=${PACK_PROTOCOL}://${PACK_PUBLIC_HOST} bind=${PACK_BIND_ADDR}"
docker compose "${args[@]}" up -d --no-build --pull never

echo "[install] product pack started as Compose project ${PROJECT}."
echo "  Fill env files copied from *.example, then re-run install.sh if the stack is waiting on secrets."
echo "  Do not merge this project with other products."
