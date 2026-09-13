#!/usr/bin/env bash
# Install Docker Engine + Compose plugin when missing.
# If Docker is already installed, leave it untouched (no remove/purge/reinstall).
set -euo pipefail

never_remove_docker() {
  echo "[install] Docker already present; will not remove, replace, or prune existing Engine/images/containers."
}

compose_ok() {
  docker compose version >/dev/null 2>&1
}

install_compose_plugin_only() {
  echo "[install] Docker Engine is present; installing Compose plugin only (Engine left as-is)."
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y docker-compose-plugin
  elif command -v yum >/dev/null 2>&1; then
    yum install -y docker-compose-plugin
  else
    echo "docker compose plugin missing and this distro has no known package manager for it." >&2
    echo "Install the Compose plugin yourself; this script will not replace Docker Engine." >&2
    return 1
  fi
}

start_docker() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable docker >/dev/null 2>&1 || true
    systemctl start docker >/dev/null 2>&1 || true
  elif command -v service >/dev/null 2>&1; then
    service docker start >/dev/null 2>&1 || true
  fi
}

install_engine() {
  if command -v docker >/dev/null 2>&1; then
    never_remove_docker
    return 0
  fi
  echo "[install] Docker not found. Installing Engine via get.docker.com (does not uninstall other services)."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://get.docker.com | sh
  else
    echo "Need curl or wget to install Docker. See https://docs.docker.com/engine/install/" >&2
    return 1
  fi
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo bash install.sh) so Docker can be installed or started." >&2
  exit 64
fi

if command -v docker >/dev/null 2>&1; then
  never_remove_docker
  docker --version || true
else
  install_engine
fi

start_docker

if ! command -v docker >/dev/null 2>&1; then
  echo "docker still not on PATH after install." >&2
  exit 78
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker is installed but the daemon is not running. Start it, then re-run install.sh." >&2
  echo "Existing Docker packages were not removed." >&2
  exit 78
fi

if ! compose_ok; then
  install_compose_plugin_only
fi

if ! compose_ok; then
  echo "docker compose plugin still missing." >&2
  exit 78
fi

echo "[install] Docker ready: $(docker --version)"
docker compose version
