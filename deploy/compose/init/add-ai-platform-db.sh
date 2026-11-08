#!/bin/sh
# Idempotent: create the ai_platform role + database on an **existing**
# control-plane Postgres volume (init/control-plane-db.sh only runs on empty PGDATA).
#
# Lab / OVH when upgrading a volume that already has logto/entitlement/notification:
#
#   export AI_PLATFORM_DB_PASSWORD=…   # same value as deploy/env/control-plane.env
#   # optional overrides: AI_PLATFORM_DB_USER AI_PLATFORM_DB_NAME
#   # optional: CONTROL_PLANE_DB_ADMIN_USER (default lw_pg)
#   #
#   # With compose stack up:
#   docker compose -p luminary-works -f deploy/compose/control-plane.yaml \
#     exec -T control-plane-db \
#     env AI_PLATFORM_DB_PASSWORD="$AI_PLATFORM_DB_PASSWORD" \
#         sh < deploy/compose/init/add-ai-platform-db.sh
#
#   # Or against a stopped volume (temporary container), see deploy/OPERATOR.md § AI Platform DB.
#
# Safe to re-run: existing role/db are left alone (password is updated to match env).
set -eu

assert_ident() {
  case "$1" in
    '' | *[!a-zA-Z0-9_]* )
      echo "add-ai-platform-db: invalid identifier: $1" >&2
      exit 1
      ;;
  esac
}

sql_literal() {
  printf "%s" "$1" | sed "s/'/''/g"
}

ADMIN_USER="${CONTROL_PLANE_DB_ADMIN_USER:-${POSTGRES_USER:-lw_pg}}"
ROLE="${AI_PLATFORM_DB_USER:-ai_platform}"
DB="${AI_PLATFORM_DB_NAME:-ai_platform}"
PASS="${AI_PLATFORM_DB_PASSWORD:?AI_PLATFORM_DB_PASSWORD is required}"

assert_ident "$ADMIN_USER"
assert_ident "$ROLE"
assert_ident "$DB"
LIT_PASS="$(sql_literal "$PASS")"

psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname postgres <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
    CREATE ROLE ${ROLE} LOGIN PASSWORD '${LIT_PASS}';
  ELSE
    ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${LIT_PASS}';
  END IF;
END
\$\$;

SELECT 'ok' WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB}');
EOSQL

EXISTS="$(psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname postgres -Atc \
  "SELECT 1 FROM pg_database WHERE datname = '${DB}'")"

if [ "$EXISTS" != "1" ]; then
  psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname postgres <<EOSQL
		CREATE DATABASE ${DB} OWNER ${ROLE};
		REVOKE ALL ON DATABASE ${DB} FROM PUBLIC;
		GRANT CONNECT, TEMPORARY ON DATABASE ${DB} TO ${ROLE};
EOSQL
  psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "$DB" <<EOSQL
		REVOKE ALL ON SCHEMA public FROM PUBLIC;
		GRANT ALL ON SCHEMA public TO ${ROLE};
		ALTER SCHEMA public OWNER TO ${ROLE};
EOSQL
  echo "add-ai-platform-db: created database ${DB} owned by ${ROLE}"
else
  echo "add-ai-platform-db: database ${DB} already exists; role password refreshed"
fi
