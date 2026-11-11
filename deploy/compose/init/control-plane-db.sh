#!/bin/sh
# First-boot only (empty PGDATA). Creates four logical databases + login roles
# for Identity (Logto), Entitlement, Notification, and AI Platform on one Postgres
# instance. An existing volume does not re-run this script; create ai_platform
# there by hand or recreate PGDATA.
# Application services must use their own role — never CONTROL_PLANE_DB_ADMIN_*.
set -eu

assert_ident() {
  # SQL identifiers only — rejects injection via CREATE DATABASE / ROLE names.
  case "$1" in
    '' | *[!a-zA-Z0-9_]* )
      echo "control-plane-db init: invalid identifier: $1" >&2
      exit 1
      ;;
  esac
}

sql_literal() {
  # Escape single quotes for SQL string literals (passwords).
  printf "%s" "$1" | sed "s/'/''/g"
}

create_app_db() {
  role="$1"
  db="$2"
  pass="$3"

  assert_ident "$role"
  assert_ident "$db"
  if [ -z "$pass" ]; then
    echo "control-plane-db init: empty password for role $role" >&2
    exit 1
  fi

  lit_pass="$(sql_literal "$pass")"

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
		CREATE ROLE ${role} LOGIN PASSWORD '${lit_pass}';
		CREATE DATABASE ${db} OWNER ${role};
		REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
		GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${role};
	EOSQL

  # Owner already has full rights inside the DB; lock down PUBLIC on schema.
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
		REVOKE ALL ON SCHEMA public FROM PUBLIC;
		GRANT ALL ON SCHEMA public TO ${role};
		ALTER SCHEMA public OWNER TO ${role};
	EOSQL
}

IDENTITY_DB_USER="${IDENTITY_DB_USER:-logto}"
IDENTITY_DB_NAME="${IDENTITY_DB_NAME:-logto}"
ENTITLEMENT_DB_USER="${ENTITLEMENT_DB_USER:-entitlement}"
ENTITLEMENT_DB_NAME="${ENTITLEMENT_DB_NAME:-entitlement}"
NOTIFICATION_DB_USER="${NOTIFICATION_DB_USER:-notification}"
NOTIFICATION_DB_NAME="${NOTIFICATION_DB_NAME:-notification}"
AI_PLATFORM_DB_USER="${AI_PLATFORM_DB_USER:-ai_platform}"
AI_PLATFORM_DB_NAME="${AI_PLATFORM_DB_NAME:-ai_platform}"

: "${IDENTITY_DB_PASSWORD:?IDENTITY_DB_PASSWORD is required for control-plane-db init}"
: "${ENTITLEMENT_DB_PASSWORD:?ENTITLEMENT_DB_PASSWORD is required for control-plane-db init}"
: "${NOTIFICATION_DB_PASSWORD:?NOTIFICATION_DB_PASSWORD is required for control-plane-db init}"
: "${AI_PLATFORM_DB_PASSWORD:?AI_PLATFORM_DB_PASSWORD is required for control-plane-db init}"

create_app_db "$IDENTITY_DB_USER" "$IDENTITY_DB_NAME" "$IDENTITY_DB_PASSWORD"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "ALTER ROLE ${IDENTITY_DB_USER} CREATEROLE CREATEDB;"
create_app_db "$ENTITLEMENT_DB_USER" "$ENTITLEMENT_DB_NAME" "$ENTITLEMENT_DB_PASSWORD"
create_app_db "$NOTIFICATION_DB_USER" "$NOTIFICATION_DB_NAME" "$NOTIFICATION_DB_PASSWORD"
create_app_db "$AI_PLATFORM_DB_USER" "$AI_PLATFORM_DB_NAME" "$AI_PLATFORM_DB_PASSWORD"

echo "control-plane-db init: created ${IDENTITY_DB_NAME}, ${ENTITLEMENT_DB_NAME}, ${NOTIFICATION_DB_NAME}, ${AI_PLATFORM_DB_NAME}"
