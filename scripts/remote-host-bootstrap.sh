#!/usr/bin/env bash
# Bootstrap a Debian/Ubuntu host for LuminaryWorks Compose deploy.
#
# Run as root (or via sudo). Idempotent.
#
#   sudo bash scripts/remote-host-bootstrap.sh --user andy
#
# Installs Docker Engine + Compose plugin, git, rsync, curl. Adds --user
# to the docker group and (on Debian/Ubuntu) sudo. Does not write product
# secrets and does not start stacks — that is scripts/remote-deploy.mjs.
set -euo pipefail

DEPLOY_USER="${SUDO_USER:-${USER:-root}}"
WITH_NODE=0
REGISTRY_MIRROR="auto"
CN_DOCKER_MIRROR="https://docker.m.daocloud.io"

usage() {
  cat <<'EOF'
Usage: remote-host-bootstrap.sh [--user <name>] [--with-node] [--registry-mirror auto|none|<url>]

  --user <name>             Account that will run docker compose (default: sudo caller)
  --with-node               Also install Node.js 24 (not required; images already use it)
  --registry-mirror auto    Probe registry-1.docker.io first; if blocked use docker.m.daocloud.io (default)
  --registry-mirror none    Never write a Docker Hub mirror
  --registry-mirror <url>   Force this pull-through (e.g. https://docker.m.daocloud.io)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      DEPLOY_USER="$2"
      shift 2
      ;;
    --with-node)
      WITH_NODE=1
      shift
      ;;
    --registry-mirror)
      REGISTRY_MIRROR="$2"
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

if [[ "$(id -u)" -ne 0 ]]; then
  echo "this script must run as root (sudo / su)" >&2
  exit 77
fi

if [[ ! -r /etc/os-release ]]; then
  echo "/etc/os-release missing — only Debian/Ubuntu are supported" >&2
  exit 78
fi
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  debian|ubuntu) ;;
  *)
    echo "unsupported distro: ${ID:-unknown} (want debian or ubuntu)" >&2
    exit 78
    ;;
esac

export DEBIAN_FRONTEND=noninteractive
mkdir -p /etc/apt/apt.conf.d
if [[ ! -f /etc/apt/apt.conf.d/99force-ipv4 ]]; then
  printf 'Acquire::ForceIPv4 "true";\n' >/etc/apt/apt.conf.d/99force-ipv4
fi

# Fresh Debian DVD installs leave a cdrom:// source that breaks `apt-get update`.
disable_cdrom_sources() {
  local f
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    [[ -f "$f" ]] || continue
    if grep -qE '^[[:space:]]*deb(-src)?[[:space:]]+cdrom:' "$f"; then
      sed -i -E 's/^[[:space:]]*(deb(-src)?[[:space:]]+cdrom:)/# \1/' "$f"
    fi
  done
}
disable_cdrom_sources

apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  gnupg \
  rsync \
  sudo \
  wget

if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "deploy user '$DEPLOY_USER' does not exist" >&2
  exit 78
fi

usermod -aG sudo "$DEPLOY_USER"
SUDOERS_FILE="/etc/sudoers.d/${DEPLOY_USER}"
if [[ ! -f "$SUDOERS_FILE" ]]; then
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$DEPLOY_USER" >"$SUDOERS_FILE"
  chmod 440 "$SUDOERS_FILE"
fi

install_docker_ce() {
  local distro_id="${ID}"
  local codename="${VERSION_CODENAME}"
  local repo_url="https://download.docker.com/linux/${distro_id}"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "${repo_url}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] %s %s stable\n' \
    "$(dpkg --print-architecture)" "$repo_url" "$codename" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_docker_distro() {
  apt-get install -y docker.io docker-cli docker-compose-v2 || apt-get install -y docker.io docker-compose
}

if ! command -v docker >/dev/null 2>&1; then
  if ! install_docker_ce; then
    echo "official Docker CE repo failed; falling back to distro docker.io" >&2
    rm -f /etc/apt/sources.list.d/docker.list
    apt-get update -y
    install_docker_distro
  fi
fi

systemctl enable --now docker
usermod -aG docker "$DEPLOY_USER"

configure_registry_mirror() {
  local mirror="$1"
  [[ -n "$mirror" ]] || return 0
  mkdir -p /etc/docker
  if [[ -f /etc/docker/daemon.json ]] && grep -q "$mirror" /etc/docker/daemon.json; then
    echo "registry mirror already configured: $mirror"
    return 0
  fi
  printf '{ "registry-mirrors": ["%s"] }\n' "$mirror" >/etc/docker/daemon.json
  systemctl restart docker
  echo "configured Docker registry mirror: $mirror"
}

probe_official_docker_hub() {
  local code
  code="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' https://registry-1.docker.io/v2/ || echo 000)"
  case "$code" in
    200|401) return 0 ;;
    *) return 1 ;;
  esac
}

apply_registry_mirror_policy() {
  local policy="${1:-auto}"
  case "$policy" in
    ""|auto)
      if probe_official_docker_hub; then
        echo "Docker Hub (registry-1.docker.io) reachable — not installing a China mirror"
        return 0
      fi
      echo "Docker Hub unreachable (typical on China mainland). Falling back to ${CN_DOCKER_MIRROR}"
      configure_registry_mirror "$CN_DOCKER_MIRROR"
      ;;
    none|off|false)
      echo "skipping Docker registry mirror (--registry-mirror none)"
      ;;
    *)
      configure_registry_mirror "$policy"
      ;;
  esac
}

apply_registry_mirror_policy "$REGISTRY_MIRROR"

install_node24() {
  local arch node_arch version tarball
  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64) node_arch=arm64 ;;
    x86_64|amd64) node_arch=x64 ;;
    *)
      echo "unsupported CPU for Node tarball: $arch" >&2
      return 1
      ;;
  esac
  version="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk '/node-v24\.[0-9.]+-linux-'"$node_arch"'\.tar\.xz/{print; exit}' | sed -E 's/.*node-(v24\.[0-9.]+)-linux-.*/\1/')"
  if [[ -z "$version" ]]; then
    version="v24.8.0"
  fi
  tarball="node-${version}-linux-${node_arch}.tar.xz"
  curl -fsSL "https://nodejs.org/dist/${version}/${tarball}" -o "/tmp/${tarball}"
  tar -xJf "/tmp/${tarball}" -C /usr/local --strip-components=1
  rm -f "/tmp/${tarball}"
  node -v
}

if [[ "$WITH_NODE" -eq 1 ]] && ! command -v node >/dev/null 2>&1; then
  install_node24
fi

docker version
docker compose version
echo "bootstrap ok — user ${DEPLOY_USER} is in docker + sudo. Open a new SSH session before docker compose."
