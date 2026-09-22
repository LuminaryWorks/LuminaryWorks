#!/usr/bin/env bash
# First-install LuminaryWorks on a Linux host.
#
# This pack does NOT include Docker Engine or Docker images.
# If Docker is missing, install.sh installs Engine + Compose plugin.
# If Docker is already installed, it is left unchanged (never remove/purge).
# site.json products.*.enabled chooses which stacks to start.
# Product host fields default to brand domains. Clear a host to use IP:port.
# Six federal products stay independent Compose projects (never merged).
#
#   sudo bash install.sh                  # config page (defaults from env / brand domains)
#   sudo bash install.sh --no-wizard --public-host <this-machine-ip>
set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_HOST=""
BIND_ADDR="0.0.0.0"
PROTOCOL="https"
PROTOCOL_SET=0
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"
WIZARD=""
WIZARD_BIND="0.0.0.0"
WIZARD_PORT=""
SKIP_ACCEPT=0
ONLY_PRODUCTS=""

usage() {
  cat <<'EOF'
Usage:
  sudo bash install.sh
  sudo bash install.sh --wizard [--wizard-bind 127.0.0.1] [--wizard-port 80]
  sudo bash install.sh --no-wizard --public-host <ip-or-dns> [--protocol https]

If Docker is missing, installs Engine + Compose via get.docker.com.
Never uninstalls or replaces an existing Docker Engine.
Refuses to start if a required host port is taken by another service.

Default: listen on 0.0.0.0:80 (then 8080, then 8099 if 80 is taken) and print
http://<public-ip>/?t=...  Host firewall is opened automatically (ufw / firewalld /
iptables). Cloud security groups cannot be changed from inside the VM without
API keys; port 80 is used because Aliyun / Tencent / AWS / OVH already allow it.
Product hosts default to brand domains. Clear a domain only for emergency IP:port.
Detects a public IPv4 on AWS / Aliyun / Tencent / GCP / Azure / any VPS;
falls back to LAN only when no public IP exists. Open the URL on an ops laptop.
After Compose is up, install.sh runs accept.sh (health + IdP login).
Re-run sudo bash accept.sh anytime.
You may skip the form and edit those files instead. Empty admin passwords are
generated; existing values are kept. Look them up in ACCOUNTS.product.env or the CSV.

--no-wizard     env / site.json only (still runs the same preflight)
--skip-accept   install stacks but do not run accept.sh at the end
--only a,b      only these federal products (skip control-plane unless listed)
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
      PROTOCOL_SET=1
      shift 2
      ;;
    --npm-registry)
      NPM_REGISTRY="$2"
      shift 2
      ;;
    --wizard)
      WIZARD=1
      shift
      ;;
    --no-wizard)
      WIZARD=0
      shift
      ;;
    --wizard-bind)
      WIZARD_BIND="$2"
      shift 2
      ;;
    --wizard-port)
      WIZARD_PORT="$2"
      shift 2
      ;;
    --skip-accept)
      SKIP_ACCEPT=1
      shift
      ;;
    --only)
      ONLY_PRODUCTS="$2"
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

if [[ -f "$KIT_DIR/ensure-docker.sh" ]]; then
  bash "$KIT_DIR/ensure-docker.sh"
else
  echo "missing ensure-docker.sh" >&2
  exit 78
fi

if [[ -d "$KIT_DIR/images" ]]; then
  echo "this pack must not contain images/; refuse to install a mixed 基座 pack" >&2
  exit 78
fi

if [[ -z "$WIZARD" ]]; then
  if [[ -n "$PUBLIC_HOST" && "$PUBLIC_HOST" != "REPLACE_WITH_HK_SERVER_IP" && "$PUBLIC_HOST" != "REPLACE_WITH_SERVER_PUBLIC_IP" ]]; then
    WIZARD=0
  else
    WIZARD=1
  fi
fi

if [[ "$WIZARD" == "1" ]]; then
  if [[ ! -f "$KIT_DIR/install-wizard.py" ]]; then
    echo "missing install-wizard.py" >&2
    exit 78
  fi
  if [[ -f "$KIT_DIR/.install-ui.closed" ]]; then
    echo "[install] config page already closed; using site.json / env (--no-wizard)"
  else
    rm -f "$KIT_DIR/.install-ui.ready" "$KIT_DIR/.install-ui.url" "$KIT_DIR/.install-ui.scope" "$KIT_DIR/.install-ui.port"
    ADVERTISE_HOST="$(
      python3 "$KIT_DIR/install-wizard.py" --kit "$KIT_DIR" --detect-host --advertise-host "${PUBLIC_HOST:-}" || true
    )"
    WIZARD_PORT_ARGS=()
    if [[ -n "$WIZARD_PORT" ]]; then
      WIZARD_PORT_ARGS=(--port "$WIZARD_PORT")
    fi
    echo "[install] opening host firewall and picking a public config port"
    python3 "$KIT_DIR/install-wizard.py" --kit "$KIT_DIR" --prepare-wizard --bind "$WIZARD_BIND" \
      "${WIZARD_PORT_ARGS[@]}"
    if [[ -f "$KIT_DIR/.install-ui.port" ]]; then
      WIZARD_PORT="$(tr -d '\n' < "$KIT_DIR/.install-ui.port")"
    fi
    if [[ -z "$WIZARD_PORT" ]]; then
      echo "could not pick a wizard port (80/8080/8099 busy?). See above." >&2
      exit 78
    fi
    echo "[install] opening config page on ${WIZARD_BIND}:${WIZARD_PORT} (1 hour TTL)"
    INSTALL_ADVERTISE_HOST="${ADVERTISE_HOST:-}" python3 "$KIT_DIR/install-wizard.py" \
      --kit "$KIT_DIR" --serve --bind "$WIZARD_BIND" --port "$WIZARD_PORT" --ttl 3600 \
      --advertise-host "${ADVERTISE_HOST:-}" \
      >>"$KIT_DIR/.install-ui.log" 2>&1 &
    WIZARD_PID=$!
    echo "[install] config page pid ${WIZARD_PID}"
    for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      if [[ -f "$KIT_DIR/.install-ui.url" ]]; then
        break
      fi
      sleep 0.3
    done
    if [[ -f "$KIT_DIR/.install-ui.url" ]]; then
      WIZARD_URL="$(tr -d '\n' < "$KIT_DIR/.install-ui.url")"
      WIZARD_SCOPE=""
      if [[ -f "$KIT_DIR/.install-ui.scope" ]]; then
        WIZARD_SCOPE="$(tr -d '\n' < "$KIT_DIR/.install-ui.scope")"
      fi
      if [[ "$WIZARD_SCOPE" == "lan" ]]; then
        echo "[install] 未检测到公网 IP，使用局域网地址（仅内网可达）:"
      else
        echo "[install] 在运维电脑浏览器打开:"
      fi
      echo "[install]   ${WIZARD_URL}"
      if [[ "$WIZARD_URL" == *"<公网IP>"* ]]; then
        echo "[install] 未能自动识别 IP，请把地址里的 <公网IP> 换成这台机器的公网或局域网地址"
      fi
    else
      echo "[install] 配置页地址见 $KIT_DIR/.install-ui.log" >&2
    fi
    echo "[install] wait until you click 开始安装 on the page..."
    while [[ ! -f "$KIT_DIR/.install-ui.ready" ]]; do
      if ! kill -0 "$WIZARD_PID" 2>/dev/null; then
        echo "config page exited before install. See $KIT_DIR/.install-ui.log" >&2
        exit 64
      fi
      sleep 1
    done
    echo "[install] form accepted. CSV is in the browser download; releasing TCP ${WIZARD_PORT} for product ingress."
    kill "$WIZARD_PID" 2>/dev/null || true
    wait "$WIZARD_PID" 2>/dev/null || true
  fi
fi

eval "$(python3 - "$KIT_DIR" "$PUBLIC_HOST" "$PROTOCOL" "$PROTOCOL_SET" <<'PY'
import json, sys
from pathlib import Path

kit = Path(sys.argv[1])
public_host, protocol, protocol_set = sys.argv[2], sys.argv[3], sys.argv[4]
site_path = kit / "site.json"
site = {}
if site_path.is_file():
    site = json.loads(site_path.read_text(encoding="utf-8"))
if not public_host or public_host in ("REPLACE_WITH_HK_SERVER_IP", "REPLACE_WITH_SERVER_PUBLIC_IP"):
    public_host = str(site.get("publicHost") or "").strip()
if protocol_set != "1":
    protocol = str(site.get("protocol") or protocol or "https").strip()
print(f"PUBLIC_HOST={public_host}")
print(f"PROTOCOL={protocol}")
PY
)"

if [[ -z "$PUBLIC_HOST" || "$PUBLIC_HOST" == "REPLACE_WITH_HK_SERVER_IP" || "$PUBLIC_HOST" == "REPLACE_WITH_SERVER_PUBLIC_IP" ]]; then
  echo "missing publicHost. Fill it in the wizard, site.json, or --public-host." >&2
  exit 64
fi

echo "[install] preflight (empty admin passwords are generated; existing values kept)"
if [[ -f "$KIT_DIR/install-runtime.py" ]]; then
  python3 "$KIT_DIR/install-runtime.py" --kit "$KIT_DIR" --allow-pnpm-builds || true
fi
if ! python3 "$KIT_DIR/install-wizard.py" --kit "$KIT_DIR" --preflight; then
  echo "preflight failed. Set public login passwords in the form or identity/ACCOUNTS.product.env." >&2
  exit 64
fi

echo "[install] checking host ports (will not take ports from unrelated services)"
if ! python3 "$KIT_DIR/install-runtime.py" --kit "$KIT_DIR" --check-ports; then
  echo "port conflict: stop or move the other service, then re-run. Existing Docker installs were not removed." >&2
  exit 78
fi

cd "$KIT_DIR"

eval "$(python3 - "$KIT_DIR" <<'PY'
import json, sys
from pathlib import Path

kit = Path(sys.argv[1])
site_path = kit / "site.json"
if not site_path.is_file():
    print("ENABLE_CONTROL_PLANE=1")
    print("PRODUCTS=''")
    raise SystemExit(0)
site = json.loads(site_path.read_text(encoding="utf-8"))
products = site.get("products") or {}
order = ["dataluminary", "blockyedu", "doerflow", "vistaremote", "vistacast", "syncrobrain"]
enabled_cp = bool((products.get("control-plane") or {}).get("enabled", True))
enabled = [name for name in order if bool((products.get(name) or {}).get("enabled"))]
print(f"ENABLE_CONTROL_PLANE={1 if enabled_cp else 0}")
print("PRODUCTS='" + " ".join(enabled) + "'")
PY
)"

if [[ "${ENABLE_CONTROL_PLANE}" != "1" && -z "${PRODUCTS}" ]]; then
  echo "nothing enabled in site.json. Set products.control-plane.enabled and/or a federal product to true." >&2
  exit 64
fi

if [[ -n "$ONLY_PRODUCTS" ]]; then
  ONLY_PRODUCTS="${ONLY_PRODUCTS//,/ }"
  ENABLE_CONTROL_PLANE=0
  for name in $ONLY_PRODUCTS; do
    if [[ "$name" == "control-plane" ]]; then
      ENABLE_CONTROL_PLANE=1
    fi
  done
  FILTERED=""
  for product in $PRODUCTS; do
    for name in $ONLY_PRODUCTS; do
      if [[ "$product" == "$name" ]]; then
        FILTERED="${FILTERED} ${product}"
      fi
    done
  done
  PRODUCTS="${FILTERED# }"
  echo "[install] --only → control-plane=${ENABLE_CONTROL_PLANE} products=${PRODUCTS:-"(none)"}"
fi

echo "[install] site.json → control-plane=${ENABLE_CONTROL_PLANE} products=${PRODUCTS:-"(none)"}"

install_control_plane() {
  if [[ ! -f "$KIT_DIR/deploy/compose/control-plane.yaml" ]]; then
    echo "missing deploy/compose/control-plane.yaml under $KIT_DIR" >&2
    exit 78
  fi
  if [[ ! -d "$KIT_DIR/services/auth-gateway" || ! -d "$KIT_DIR/services/entitlement" || ! -d "$KIT_DIR/apps/control-console" ]]; then
    echo "missing control-plane build context" >&2
    exit 78
  fi

  ENV_FILE="$KIT_DIR/deploy/env/control-plane.env"
  mkdir -p "$KIT_DIR/deploy/env"
  chmod 700 "$KIT_DIR/deploy/env"

  HOST_ENV="${HOME}/luminaryworks/deploy/env/control-plane.env"
  if [[ -f "$HOST_ENV" && ! -f "$ENV_FILE" ]]; then
    cp "$HOST_ENV" "$ENV_FILE"
    echo "[install] reused $HOST_ENV"
  fi
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "missing $ENV_FILE — this kit should already contain that file for you to edit" >&2
    exit 78
  fi

  python3 - "$ENV_FILE" "$PUBLIC_HOST" "$BIND_ADDR" "$PROTOCOL" "$NPM_REGISTRY" "$KIT_DIR" <<'PY'
import importlib.util, secrets, sys
from pathlib import Path

dest, public_host, bind_addr, protocol, npm_registry, kit = sys.argv[1:7]
dest_path = Path(dest)
kit_path = Path(kit)
existing = {}
raw_lines = dest_path.read_text(encoding="utf-8").splitlines()
for raw in raw_lines:
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    existing[k.strip()] = v.strip().strip('"').strip("'")

spec = importlib.util.spec_from_file_location("lw_rt", kit_path / "install-runtime.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
plan = mod.public_url_plan(kit_path)
identity = plan["IDENTITY_ENDPOINT"]
console = plan["CONTROL_CONSOLE_PUBLIC_URL"]
forced = {
    "CONTROL_PLANE_BIND_ADDR": bind_addr,
    "CONTROL_PLANE_ADMIN_BIND_ADDR": "127.0.0.1",
    "IDENTITY_ENDPOINT": identity,
    "IDENTITY_ADMIN_ENDPOINT": "http://127.0.0.1:3002",
    "AUTH_GATEWAY_PUBLIC_URL": plan["AUTH_GATEWAY_PUBLIC_URL"],
    "ENTITLEMENT_OIDC_ISSUER": plan["ENTITLEMENT_OIDC_ISSUER"],
    "CONTROL_CONSOLE_PUBLIC_URL": console,
    "CONTROL_CONSOLE_IDP_ISSUER": plan["CONTROL_CONSOLE_IDP_ISSUER"],
    "CONTROL_CONSOLE_ENTITLEMENT_BASE_URL": plan["CONTROL_CONSOLE_ENTITLEMENT_BASE_URL"],
    "CONTROL_CONSOLE_AUTH_EXPERIENCE_URL": plan["CONTROL_CONSOLE_AUTH_EXPERIENCE_URL"],
    "ENTITLEMENT_CORS_ORIGINS": plan["ENTITLEMENT_CORS_ORIGINS"],
    "NPM_REGISTRY": npm_registry,
    "OBJECT_STORAGE_ENABLED": "0",
}
secret_keys = [
    "IDENTITY_DB_PASSWORD",
    "ENTITLEMENT_DB_PASSWORD",
    "ENTITLEMENT_SERVICE_API_KEY",
    "ENTITLEMENT_PARTNER_SECRET_PEPPER",
    "ENTITLEMENT_PARTNER_TOKEN_SECRET",
    "AI_VAULT_MASTER_KEY",
    "PAYMENT_CONFIG_MASTER_KEY",
]
secrets_out = {}
for key in secret_keys:
    prev = existing.get(key) or ""
    secrets_out[key] = prev if prev else secrets.token_hex(32)

out = []
for raw in raw_lines:
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
dest_path.write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"wrote {dest}")
PY
  chmod 600 "$ENV_FILE"

  ID_ENV="$KIT_DIR/identity/.env"
  if [[ -f "$ID_ENV" ]]; then
    python3 - "$ID_ENV" "$KIT_DIR" <<'PY'
import importlib.util, sys
from pathlib import Path

dest, kit = sys.argv[1:3]
kit_path = Path(kit)
spec = importlib.util.spec_from_file_location("lw_rt", kit_path / "install-runtime.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
plan = mod.public_url_plan(kit_path)
forced = {
    "IDENTITY_ENDPOINT": plan["IDENTITY_ENDPOINT"],
    "IDENTITY_ADMIN_ENDPOINT": "http://127.0.0.1:3002",
    "IDP_ISSUER": plan["IDP_ISSUER"],
    "IDENTITY_ACCOUNTS_PROFILE": "product",
}
path = Path(dest)
out = []
for raw in path.read_text(encoding="utf-8").splitlines():
    stripped = raw.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        out.append(raw)
        continue
    key = stripped.split("=", 1)[0].strip()
    if key in forced:
        out.append(f"{key}={forced[key]}")
    else:
        out.append(raw)
path.write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"wrote {dest}")
PY
    chmod 600 "$ID_ENV"
  fi
  if [[ -f "$KIT_DIR/identity/ACCOUNTS.product.env" ]]; then
    chmod 600 "$KIT_DIR/identity/ACCOUNTS.product.env"
  fi

  echo "[install] control-plane compose up --build"
  docker compose --env-file "$ENV_FILE" -f "$KIT_DIR/deploy/compose/control-plane.yaml" \
    up -d --build --remove-orphans

  echo "[install] control-plane started."
  echo "  OIDC:        ${PROTOCOL}://${PUBLIC_HOST} (or login.<control-plane-host> when domains are set)"
  echo "  Gateway:     ${PROTOCOL}://${PUBLIC_HOST}:3010/ready"
  echo "  Entitlement: ${PROTOCOL}://${PUBLIC_HOST}:3040/ready"
  echo "  Console:     ${PROTOCOL}://${PUBLIC_HOST}:3050/health"
  echo "  Logto Admin: ssh -L 3002:127.0.0.1:3002 USER@${PUBLIC_HOST}  then http://127.0.0.1:3002"
}

seed_product_env() {
  local product="$1"
  local root="$2"
  python3 - "$root" "$product" "$KIT_DIR/site.json" <<'PY'
import json, re, secrets, sys
from pathlib import Path

root = Path(sys.argv[1])
product = sys.argv[2]
site = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
secret_keys = ("_SECRET", "_PASSWORD", "_KEY")

for example in root.rglob("*.example"):
    dest = Path(str(example)[: -len(".example")])
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"[install] seeded {dest.relative_to(root)}")

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
        print(f"[install] filled empty secrets in {path.relative_to(root)}")

for env_path in root.rglob("*.env"):
    if env_path.name.endswith(".example"):
        continue
    fill_env(env_path)

blocky = ((site.get("products") or {}).get("blockyedu") or {})
if product == "blockyedu" and blocky.get("enabled"):
    seed = blocky.get("seed") or {}
    default_packs = ["syncrobrain", "dataluminary", "vistacast", "doerflow", "vistaremote"]
    default_oer = ["oer-growth-v1"]
    packs = seed["packs"] if isinstance(seed.get("packs"), list) else default_packs
    oer_growth = seed["oerGrowth"] if isinstance(seed.get("oerGrowth"), list) else default_oer
    patches = {
        "EDU_SEED_PROFILE": str(seed.get("profile") or "full-demo"),
        "EDU_SEED_PACKS": ",".join(str(p) for p in packs),
        "EDU_OER_GROWTH": ",".join(str(c) for c in oer_growth),
        "ALLOW_LOCAL_LOGIN": "false",
    }
    for env_path in list(root.rglob("*.env")):
        if env_path.name.endswith(".example"):
            continue
        lines = env_path.read_text(encoding="utf-8").splitlines()
        keys_seen = set()
        out = []
        for raw in lines:
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", raw.strip())
            if m and m.group(1) in patches:
                out.append(f"{m.group(1)}={patches[m.group(1)]}")
                keys_seen.add(m.group(1))
            else:
                out.append(raw)
        for key, value in patches.items():
            if key not in keys_seen:
                out.append(f"{key}={value}")
        env_path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY
}

install_product() {
  local product="$1"
  local manifest="$KIT_DIR/products/MANIFEST.json"
  local root="$KIT_DIR/products/$product"
  if [[ ! -f "$manifest" ]]; then
    echo "missing products/MANIFEST.json — this kit has no federal products" >&2
    exit 78
  fi
  if [[ ! -d "$root" ]]; then
    echo "site.json enabled $product but $root is not in this kit" >&2
    exit 78
  fi

  eval "$(python3 - "$manifest" "$product" <<'PY'
import json, sys
from pathlib import Path
manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
product = sys.argv[2]
spec = (manifest.get("products") or {}).get(product)
if not spec:
    raise SystemExit(f"products/MANIFEST.json has no {product}")
project = spec.get("project") or f"lw-{product}"
files = spec.get("compose") or []
print(f"PROJECT={project}")
print("COMPOSE_FILES=(")
for f in files:
    print(f"  {f!r}")
print(")")
PY
)"

  if [[ ${#COMPOSE_FILES[@]} -eq 0 ]]; then
    echo "no compose files for $product" >&2
    exit 78
  fi

  seed_product_env "$product" "$root"

  local first="${COMPOSE_FILES[0]}"
  local compose_dir="$root/$(dirname "$first")"
  local args=(--project-name "$PROJECT" --project-directory "$compose_dir")
  local envf
  for envf in \
    "$root/.env" \
    "$compose_dir/.env" \
    "$root/deploy/.env" \
    "$root/deploy/standalone/.env" \
    "$root/deploy/standalone/standalone.env" \
    "$root/deploy/edu/.env" \
    "$root/deploy/compose/.env"
  do
    if [[ -f "$envf" ]]; then
      args+=(--env-file "$envf")
    fi
  done
  if [[ -d "$root/deploy/env" ]]; then
    for envf in "$root"/deploy/env/*.env; do
      if [[ -f "$envf" ]]; then
        args+=(--env-file "$envf")
      fi
    done
  fi
  local file
  for file in "${COMPOSE_FILES[@]}"; do
    args+=(-f "$root/$file")
  done

  echo "[install] $product compose up --build project=$PROJECT"
  (
    export DATALUMINARY_BIND_HOST=0.0.0.0
    export GATEWAY_BIND_ADDRESS=0.0.0.0
    export DOERFLOW_WEB_BIND=0.0.0.0
    export DOERFLOW_ADMIN_BIND=0.0.0.0
    export CONSOLE_BIND_ADDR=0.0.0.0
    export GATEWAY_BIND_ADDR=0.0.0.0
    export TB_BIND_ADDR=0.0.0.0
    export VR_SERVER_HOST_PORT=15200
    export AI_MODE=off
    docker compose "${args[@]}" up -d --build --remove-orphans
  )
  if [[ -f "$KIT_DIR/install-runtime.py" ]]; then
    python3 "$KIT_DIR/install-runtime.py" --kit "$KIT_DIR" --post-up "$product"
  fi
  echo "[install] $product started as Compose project ${PROJECT} (independent of other products)."
}

if [[ "${ENABLE_CONTROL_PLANE}" == "1" ]]; then
  install_control_plane
  if [[ -f "$KIT_DIR/install-runtime.py" && -d "$KIT_DIR/identity/scripts" ]]; then
    echo "[install] register apps and seed product logins"
    python3 "$KIT_DIR/install-runtime.py" --kit "$KIT_DIR" --bootstrap-identity
  else
    echo "[install] skip identity seed (identity/scripts not in this kit)" >&2
  fi
fi

if [[ -f "$KIT_DIR/install-runtime.py" ]]; then
  python3 "$KIT_DIR/install-runtime.py" --kit "$KIT_DIR" --patch-product-env >/dev/null
  if [[ "${ENABLE_CONTROL_PLANE}" == "1" && -f "$KIT_DIR/deploy/env/control-plane.env" ]]; then
    echo "[install] recreate control-console with registered IdP client id"
    docker compose --env-file "$KIT_DIR/deploy/env/control-plane.env" \
      -f "$KIT_DIR/deploy/compose/control-plane.yaml" \
      up -d --no-build --force-recreate control-console
  fi
fi

for product in ${PRODUCTS}; do
  install_product "$product"
done

if [[ -f "$KIT_DIR/install-runtime.py" ]]; then
  echo "[install] Host-based ingress on :80 when product hosts are domains"
  python3 "$KIT_DIR/install-runtime.py" --kit "$KIT_DIR" --apply-ingress
fi

echo
echo "[install] stacks are up. Object storage / AI profiles were not started."
echo "  Passwords: identity/ACCOUNTS.product.env (and CSV on the config page)"
echo "  Memory plan: deploy/env/memory.env (working set vs mem_limit ceilings)"
echo "  If the config page is still open: download CSV, then close it. It auto-closes in 1 hour."

if [[ "$SKIP_ACCEPT" == "1" ]]; then
  echo "[install] skipped accept.sh (--skip-accept). Run: sudo bash accept.sh"
  exit 0
fi
if [[ -f "$KIT_DIR/install-runtime.py" ]]; then
  echo "[install] acceptance (health + IdP login)"
  python3 "$KIT_DIR/install-runtime.py" --kit "$KIT_DIR" --accept
else
  echo "[install] accept runtime missing; skip" >&2
fi
