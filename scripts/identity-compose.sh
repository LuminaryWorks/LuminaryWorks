#!/usr/bin/env bash
# Route identity docker compose actions to the shared luminary-works stack
# when deploy/env/control-plane.env exists; otherwise standalone Identity.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACTION="${1:-ps}"
CP_ENV="$ROOT/deploy/env/control-plane.env"
CP_COMPOSE="$ROOT/deploy/compose/control-plane.yaml"
CP_PORTS="$ROOT/deploy/compose/control-plane.dev-ports.yaml"

if [ -f "$CP_ENV" ] && [ -f "$CP_COMPOSE" ]; then
  PROJECT="$(grep -E '^CONTROL_PLANE_PROJECT=' "$CP_ENV" | cut -d= -f2- || true)"
  PROJECT="${PROJECT:-luminary-works}"
  case "$ACTION" in
    stop)
      docker compose --env-file "$CP_ENV" -p "$PROJECT" -f "$CP_COMPOSE" -f "$CP_PORTS" \
        stop identity identity-redis
      ;;
    down)
      # Remove Identity + Redis only; keep shared Postgres.
      docker compose --env-file "$CP_ENV" -p "$PROJECT" -f "$CP_COMPOSE" -f "$CP_PORTS" \
        rm -sf identity identity-redis 2>/dev/null || true
      docker compose --env-file "$CP_ENV" -p "$PROJECT" -f "$CP_COMPOSE" -f "$CP_PORTS" \
        stop identity identity-redis 2>/dev/null || true
      ;;
    ps)
      docker compose --env-file "$CP_ENV" -p "$PROJECT" -f "$CP_COMPOSE" -f "$CP_PORTS" ps
      ;;
    *)
      echo "Usage: $0 <stop|down|ps>" >&2
      exit 1
      ;;
  esac
  exit 0
fi

cd "$ROOT/identity"
case "$ACTION" in
  stop) docker compose -f docker-compose.yml -f docker-compose.standalone-db.yml --profile standalone-db stop ;;
  down) docker compose -f docker-compose.yml -f docker-compose.standalone-db.yml --profile standalone-db down ;;
  ps) docker compose -f docker-compose.yml -f docker-compose.standalone-db.yml --profile standalone-db ps ;;
  *) echo "Usage: $0 <stop|down|ps>" >&2; exit 1 ;;
esac
