#!/bin/sh
# Idempotent AIStor bootstrap: private buckets, least-privilege identities,
# and hard bucket quotas. Fail closed: attach / policy-update / quota never
# swallow a failed command. Intended for quay.io/minio/aistor/mc (or the server image).
#
# AIStor Free does not include replication or lifecycle *transition*.
# Expiration of trial/ is best-effort; product trial.purge is authoritative.
# Hard 120 GiB budget is enforced by `mc quota set` (required).
set -eu

ALIAS="${AISTOR_ALIAS:-local}"
ENDPOINT="${AISTOR_ENDPOINT:-http://object-storage:9000}"
POLICY_DIR="${AISTOR_POLICY_DIR:-/bootstrap/policies}"
BUDGET_GIB="${AISTOR_BUDGET_GIB:-120}"

need() {
  eval "val=\${$1-}"
  if [ -z "$val" ]; then
    echo "missing required env $1" >&2
    exit 78
  fi
}

need AISTOR_ROOT_USER
need AISTOR_ROOT_PASSWORD
need AISTOR_LUMINARY_ACCESS_KEY
need AISTOR_LUMINARY_SECRET_KEY
need AISTOR_DATALUMINARY_ACCESS_KEY
need AISTOR_DATALUMINARY_SECRET_KEY
need AISTOR_BLOCKYEDU_ACCESS_KEY
need AISTOR_BLOCKYEDU_SECRET_KEY
need AISTOR_VISTAREMOTE_ACCESS_KEY
need AISTOR_VISTAREMOTE_SECRET_KEY
need AISTOR_VISTACAST_ACCESS_KEY
need AISTOR_VISTACAST_SECRET_KEY
need AISTOR_BACKUP_ACCESS_KEY
need AISTOR_BACKUP_SECRET_KEY

if [ "$AISTOR_LUMINARY_ACCESS_KEY" = "$AISTOR_ROOT_USER" ] \
  || [ "$AISTOR_DATALUMINARY_ACCESS_KEY" = "$AISTOR_ROOT_USER" ] \
  || [ "$AISTOR_BLOCKYEDU_ACCESS_KEY" = "$AISTOR_ROOT_USER" ] \
  || [ "$AISTOR_VISTAREMOTE_ACCESS_KEY" = "$AISTOR_ROOT_USER" ] \
  || [ "$AISTOR_VISTACAST_ACCESS_KEY" = "$AISTOR_ROOT_USER" ] \
  || [ "$AISTOR_BACKUP_ACCESS_KEY" = "$AISTOR_ROOT_USER" ]; then
  echo "product/operator access keys must not equal AISTOR_ROOT_USER" >&2
  exit 78
fi

QUOTA_LUMINARY="${AISTOR_QUOTA_LUMINARY_MEDIA_GIB:-8}"
QUOTA_DATALUMINARY="${AISTOR_QUOTA_DATALUMINARY_MEDIA_GIB:-10}"
QUOTA_BLOCKYEDU="${AISTOR_QUOTA_BLOCKYEDU_MEDIA_GIB:-8}"
QUOTA_VISTAREMOTE="${AISTOR_QUOTA_VISTAREMOTE_RECORDINGS_GIB:-40}"
QUOTA_VISTACAST="${AISTOR_QUOTA_VISTACAST_RECORDINGS_GIB:-40}"
QUOTA_BACKUP="${AISTOR_QUOTA_BACKUP_STAGING_GIB:-14}"

quota_sum=$((QUOTA_LUMINARY + QUOTA_DATALUMINARY + QUOTA_BLOCKYEDU + QUOTA_VISTAREMOTE + QUOTA_VISTACAST + QUOTA_BACKUP))
if [ "$quota_sum" -gt "$BUDGET_GIB" ]; then
  echo "FATAL: bucket quotas sum to ${quota_sum} GiB > ${BUDGET_GIB} GiB hard budget" >&2
  exit 78
fi

echo "[object-storage-init] alias ${ALIAS} -> ${ENDPOINT}"
mc alias set "$ALIAS" "$ENDPOINT" "$AISTOR_ROOT_USER" "$AISTOR_ROOT_PASSWORD"

ensure_bucket() {
  bucket="$1"
  mc mb --ignore-existing "${ALIAS}/${bucket}"
}

ensure_policy() {
  name="$1"
  file="${POLICY_DIR}/${name}.json"
  if [ ! -f "$file" ]; then
    echo "missing policy file $file" >&2
    exit 78
  fi
  if mc admin policy info "$ALIAS" "$name" >/dev/null 2>&1; then
    if mc admin policy put "$ALIAS" "$name" "$file"; then
      echo "[object-storage-init] policy ${name} updated (put)"
      return 0
    fi
    if mc admin policy create "$ALIAS" "$name" "$file"; then
      echo "[object-storage-init] policy ${name} updated (create)"
      return 0
    fi
    if mc admin policy update "$ALIAS" "$name" "$file"; then
      echo "[object-storage-init] policy ${name} updated (update)"
      return 0
    fi
    echo "FATAL: could not update existing policy ${name}; no supported put/create/update command succeeded" >&2
    exit 1
  fi
  if mc admin policy create "$ALIAS" "$name" "$file"; then
    echo "[object-storage-init] policy ${name} created"
    return 0
  fi
  echo "FATAL: could not create policy ${name}" >&2
  exit 1
}

ensure_user() {
  access="$1"
  secret="$2"
  if mc admin user info "$ALIAS" "$access" >/dev/null 2>&1; then
    echo "[object-storage-init] user ${access} exists"
  else
    mc admin user add "$ALIAS" "$access" "$secret"
  fi
}

policy_already_attached() {
  policy="$1"
  access="$2"
  mc admin user info "$ALIAS" "$access" 2>/dev/null | grep -F "$policy" >/dev/null
}

attach_policy() {
  policy="$1"
  access="$2"
  if policy_already_attached "$policy" "$access"; then
    echo "[object-storage-init] policy ${policy} already attached to ${access}"
    return 0
  fi
  if mc admin policy attach "$ALIAS" "$policy" --user "$access"; then
    echo "[object-storage-init] attached ${policy} to ${access}"
    return 0
  fi
  if mc admin policy attach "$ALIAS" --user "$access" "$policy"; then
    echo "[object-storage-init] attached ${policy} to ${access} (alt syntax)"
    return 0
  fi
  if policy_already_attached "$policy" "$access"; then
    echo "[object-storage-init] policy ${policy} attached (verified after command errors)"
    return 0
  fi
  echo "FATAL: could not attach policy ${policy} to ${access}; no supported attach syntax succeeded" >&2
  exit 1
}

set_hard_quota() {
  bucket="$1"
  gib="$2"
  target="${ALIAS}/${bucket}"
  size="${gib}Gi"
  if mc quota set "$target" --hard "$size"; then
    echo "[object-storage-init] quota ${bucket}=${size} (mc quota set --hard)"
    return 0
  fi
  if mc quota set "$target" "$size"; then
    echo "[object-storage-init] quota ${bucket}=${size} (mc quota set)"
    return 0
  fi
  if mc admin bucket quota "$target" --hard "$size"; then
    echo "[object-storage-init] quota ${bucket}=${size} (mc admin bucket quota --hard)"
    return 0
  fi
  echo "FATAL: hard quota is required for ${bucket} (${size}). mc quota set is unsupported or failed; 120 GiB budget cannot be enforced." >&2
  exit 1
}

ensure_trial_expiration() {
  bucket="$1"
  # Expiration only — never lifecycle transition / site copy on AIStor Free.
  if mc ilm rule add "${ALIAS}/${bucket}" --expire-days 7 --prefix "trial/" >/dev/null 2>&1; then
    echo "[object-storage-init] ilm expire trial/ 7d on ${bucket}"
  else
    echo "[object-storage-init] WARN: lifecycle expiration not applied on ${bucket}; product trial.purge remains authoritative"
  fi
}

ensure_bucket luminary-media
ensure_bucket dataluminary-media
ensure_bucket blockyedu-media
ensure_bucket vistaremote-recordings
ensure_bucket vistacast-recordings
ensure_bucket backup-staging

set_hard_quota luminary-media "$QUOTA_LUMINARY"
set_hard_quota dataluminary-media "$QUOTA_DATALUMINARY"
set_hard_quota blockyedu-media "$QUOTA_BLOCKYEDU"
set_hard_quota vistaremote-recordings "$QUOTA_VISTAREMOTE"
set_hard_quota vistacast-recordings "$QUOTA_VISTACAST"
set_hard_quota backup-staging "$QUOTA_BACKUP"

ensure_policy luminary-media-rw
ensure_policy dataluminary-media-rw
ensure_policy blockyedu-media-rw
ensure_policy vistaremote-recordings-rw
ensure_policy vistacast-recordings-rw
ensure_policy backup-staging-rw

ensure_user "$AISTOR_LUMINARY_ACCESS_KEY" "$AISTOR_LUMINARY_SECRET_KEY"
ensure_user "$AISTOR_DATALUMINARY_ACCESS_KEY" "$AISTOR_DATALUMINARY_SECRET_KEY"
ensure_user "$AISTOR_BLOCKYEDU_ACCESS_KEY" "$AISTOR_BLOCKYEDU_SECRET_KEY"
ensure_user "$AISTOR_VISTAREMOTE_ACCESS_KEY" "$AISTOR_VISTAREMOTE_SECRET_KEY"
ensure_user "$AISTOR_VISTACAST_ACCESS_KEY" "$AISTOR_VISTACAST_SECRET_KEY"
ensure_user "$AISTOR_BACKUP_ACCESS_KEY" "$AISTOR_BACKUP_SECRET_KEY"

attach_policy luminary-media-rw "$AISTOR_LUMINARY_ACCESS_KEY"
attach_policy dataluminary-media-rw "$AISTOR_DATALUMINARY_ACCESS_KEY"
attach_policy blockyedu-media-rw "$AISTOR_BLOCKYEDU_ACCESS_KEY"
attach_policy vistaremote-recordings-rw "$AISTOR_VISTAREMOTE_ACCESS_KEY"
attach_policy vistacast-recordings-rw "$AISTOR_VISTACAST_ACCESS_KEY"
attach_policy backup-staging-rw "$AISTOR_BACKUP_ACCESS_KEY"

ensure_trial_expiration luminary-media
ensure_trial_expiration dataluminary-media
ensure_trial_expiration blockyedu-media
ensure_trial_expiration vistaremote-recordings
ensure_trial_expiration vistacast-recordings

echo "[object-storage-init] bootstrap complete (quotas ${quota_sum}/${BUDGET_GIB} GiB)"
