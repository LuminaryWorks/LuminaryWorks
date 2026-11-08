#!/usr/bin/env bash
# Nightly per-database pg_dump of control-plane-db. No Node required.
# Retention default: 14 days under .db-backups/nightly only.
# Does not delete volumes or consolidate backup directories.
# Does not print passwords. Do not run with set -x.
#
#   bash deploy/scripts/pg-backup.sh
#   PG_BACKUP_RETENTION_DAYS=14 bash deploy/scripts/pg-backup.sh
set -eu
umask 077

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/env/control-plane.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "pg-backup: missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

PROJECT="${CONTROL_PLANE_PROJECT:-luminary-works}"
ADMIN="${CONTROL_PLANE_DB_ADMIN_USER:-lw_pg}"
RETENTION="${PG_BACKUP_RETENTION_DAYS:-14}"
case "$ADMIN" in
  ""|*[!A-Za-z0-9_]*) echo "pg-backup: unsafe admin role" >&2; exit 1 ;;
esac
case "$RETENTION" in
  ""|*[!0-9]*) echo "pg-backup: retention must be a positive integer" >&2; exit 1 ;;
esac

CID="$(docker ps -q \
  --filter "label=com.docker.compose.service=control-plane-db" \
  --filter "label=com.docker.compose.project=${PROJECT}" | head -n 1)"
if [ -z "$CID" ]; then
  echo "pg-backup: control-plane-db is not running (project ${PROJECT})" >&2
  exit 1
fi

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DEST="$ROOT/.db-backups/nightly/$STAMP"
mkdir -p "$DEST"
chmod 700 "$ROOT/.db-backups" "$ROOT/.db-backups/nightly" "$DEST"
if [ ! -f "$ROOT/.db-backups/.gitignore" ]; then
  printf '*\n!.gitignore\n' > "$ROOT/.db-backups/.gitignore"
fi

dump_one() {
  db="$1"
  case "$db" in
    ""|*[!A-Za-z0-9_]*) echo "pg-backup: unsafe database name" >&2; exit 1 ;;
  esac
  echo "dump ${db}"
  docker exec -i "$CID" pg_dump -U "$ADMIN" -d "$db" -Fc --no-password > "$DEST/${db}.dump"
  chmod 600 "$DEST/${db}.dump"
  docker exec -i "$CID" psql -U "$ADMIN" -d "$db" -v ON_ERROR_STOP=1 -At -F '|' -c \
    "SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1" \
    > "$DEST/${db}.tables"
  : > "$DEST/${db}.counts.tsv"
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    schema="${rel%%.*}"
    table="${rel#*.}"
    case "$schema" in
      ""|*[!A-Za-z0-9_]*) echo "pg-backup: unsafe schema" >&2; exit 1 ;;
    esac
    case "$table" in
      ""|*[!A-Za-z0-9_]*) echo "pg-backup: unsafe table" >&2; exit 1 ;;
    esac
    count="$(docker exec -i "$CID" psql -U "$ADMIN" -d "$db" -v ON_ERROR_STOP=1 -At -c "SELECT count(*) FROM \"${schema}\".\"${table}\"")"
    printf '%s\t%s\n' "$rel" "$count" >> "$DEST/${db}.counts.tsv"
  done < "$DEST/${db}.tables"
  rows="$(awk -F '\t' '{s+=$2} END {print s+0}' "$DEST/${db}.counts.tsv")"
  tables="$(wc -l < "$DEST/${db}.tables" | tr -d ' ')"
  echo "  ${db}: tables=${tables} rows=${rows}"
}

dump_one "${IDENTITY_DB_NAME:-logto}"
dump_one "${ENTITLEMENT_DB_NAME:-entitlement}"
dump_one "${NOTIFICATION_DB_NAME:-notification}"
dump_one "${AI_PLATFORM_DB_NAME:-ai_platform}"

find "$ROOT/.db-backups/nightly" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION" -exec rm -rf {} +

upload() {
  if [ -n "${PG_BACKUP_UPLOAD_COMMAND:-}" ]; then
    if ! PG_BACKUP_DIR="$DEST" sh -c "$PG_BACKUP_UPLOAD_COMMAND"; then
      echo "pg-backup: upload hook failed (dumps kept)" >&2
    else
      echo "upload hook finished"
    fi
  fi
  if [ -z "${PG_BACKUP_S3_ENDPOINT:-}" ] || [ -z "${AISTOR_BACKUP_ACCESS_KEY:-}" ] || [ -z "${AISTOR_BACKUP_SECRET_KEY:-}" ]; then
    echo "object-storage upload not configured (skipped)"
    return 0
  fi
  if ! command -v mc >/dev/null 2>&1; then
    echo "object-storage credentials present but mc is not installed (skipped)"
    return 0
  fi
  bucket="${PG_BACKUP_S3_BUCKET:-backup-staging}"
  scheme="https"
  case "$PG_BACKUP_S3_ENDPOINT" in
    http://*) scheme="http" ;;
  esac
  host="${PG_BACKUP_S3_ENDPOINT#http://}"
  host="${host#https://}"
  host="${host%/}"
  export MC_HOST_lwbackup="${scheme}://${AISTOR_BACKUP_ACCESS_KEY}:${AISTOR_BACKUP_SECRET_KEY}@${host}"
  if ! mc cp --recursive "$DEST" "lwbackup/${bucket}/pg/${STAMP}"; then
    echo "pg-backup: mc upload failed (dumps kept)" >&2
  else
    echo "uploaded to ${bucket}"
  fi
  unset MC_HOST_lwbackup
}

upload
echo "nightly backup: $DEST"
