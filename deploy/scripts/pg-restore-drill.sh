#!/usr/bin/env bash
# Restore the latest nightly dumps into zz_drill_* databases, compare counts, drop them.
# Does not delete Docker volumes. Refuses to drop any database that is not zz_drill_*.
#
#   bash deploy/scripts/pg-restore-drill.sh
#   BACKUP_DIR=.db-backups/nightly/<stamp> bash deploy/scripts/pg-restore-drill.sh
set -eu
umask 077

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/deploy/env/control-plane.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "pg-restore-drill: missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

PROJECT="${CONTROL_PLANE_PROJECT:-luminary-works}"
ADMIN="${CONTROL_PLANE_DB_ADMIN_USER:-lw_pg}"
case "$ADMIN" in
  ""|*[!A-Za-z0-9_]*) echo "pg-restore-drill: unsafe admin role" >&2; exit 1 ;;
esac

CID="$(docker ps -q \
  --filter "label=com.docker.compose.service=control-plane-db" \
  --filter "label=com.docker.compose.project=${PROJECT}" | head -n 1)"
if [ -z "$CID" ]; then
  echo "pg-restore-drill: control-plane-db is not running (project ${PROJECT})" >&2
  exit 1
fi

if [ -n "${BACKUP_DIR:-}" ]; then
  DIR="$BACKUP_DIR"
  case "$DIR" in
    /*) ;;
    *) DIR="$ROOT/$DIR" ;;
  esac
else
  DIR="$(find "$ROOT/.db-backups/nightly" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
fi
if [ -z "${DIR:-}" ] || [ ! -d "$DIR" ]; then
  echo "pg-restore-drill: no backup directory" >&2
  exit 1
fi

SUFFIX="$(date -u +%Y%m%d%H%M%S)"
FAILED=0

for dump in "$DIR"/*.dump; do
  [ -f "$dump" ] || continue
  base="$(basename "$dump" .dump)"
  case "$base" in
    ""|*[!A-Za-z0-9_]*) echo "pg-restore-drill: skip unsafe name $base" >&2; FAILED=1; continue ;;
  esac
  drill="zz_drill_${base}_${SUFFIX}"
  case "$drill" in
    zz_drill_*) ;;
    *) echo "pg-restore-drill: refusing $drill" >&2; exit 1 ;;
  esac
  echo "drill ${base} -> ${drill}"
  docker exec -i "$CID" psql -U "$ADMIN" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${drill}"
  if ! docker exec -i "$CID" pg_restore -U "$ADMIN" -d "$drill" --no-owner --no-acl --exit-on-error --single-transaction --no-password < "$dump"; then
    echo "pg-restore-drill: restore failed for ${base}" >&2
    FAILED=1
  elif [ -f "$DIR/${base}.counts.tsv" ]; then
    docker exec -i "$CID" psql -U "$ADMIN" -d "$drill" -v ON_ERROR_STOP=1 -At -F '|' -c \
      "SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1" \
      > "$DIR/.drill-${drill}.tables"
    : > "$DIR/.drill-${drill}.tsv"
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      schema="${rel%%.*}"
      table="${rel#*.}"
      count="$(docker exec -i "$CID" psql -U "$ADMIN" -d "$drill" -At -c "SELECT count(*) FROM \"${schema}\".\"${table}\"")"
      printf '%s\t%s\n' "$rel" "$count" >> "$DIR/.drill-${drill}.tsv"
    done < "$DIR/.drill-${drill}.tables"
    if ! diff -u "$DIR/${base}.counts.tsv" "$DIR/.drill-${drill}.tsv"; then
      echo "pg-restore-drill: count mismatch for ${base}" >&2
      FAILED=1
    else
      echo "  ok ${base}"
    fi
    rm -f "$DIR/.drill-${drill}.tables" "$DIR/.drill-${drill}.tsv"
  else
    echo "  restored ${base} (no counts.tsv)"
  fi
  docker exec -i "$CID" psql -U "$ADMIN" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${drill} WITH (FORCE)"
  echo "  dropped ${drill}"
done

if [ "$FAILED" -ne 0 ]; then
  echo "pg-restore-drill: failed" >&2
  exit 1
fi
echo "restore drill ok ($DIR)"
