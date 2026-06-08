#!/usr/bin/env bash
# LuminaryWorks MetaRepo — clone sub-repos into nested directories
set -euo pipefail
cd "$(dirname "$0")"
ORG="git@github.com:LuminaryWorks"

clone_if_missing() {
  local name=$1 dir=$2
  if [ -d "$dir/.git" ]; then
    echo "= $name already at $dir/"
    return
  fi
  echo "+ cloning $name -> $dir/"
  git clone "$ORG/$name.git" "$dir"
}

clone_if_missing docs docs
clone_if_missing identity identity
clone_if_missing shared shared

echo ""
echo "Done. Next: pnpm bootstrap"
