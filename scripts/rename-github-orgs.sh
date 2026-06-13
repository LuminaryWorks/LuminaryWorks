#!/usr/bin/env bash
# LuminaryWorks — GitHub 组织 rename（需 gh auth login）
# Usage: ./scripts/rename-github-orgs.sh [--what-if]
set -euo pipefail

WHATIF=false
[[ "${1:-}" == "--what-if" ]] && WHATIF=true

if ! gh auth status >/dev/null 2>&1; then
  echo "Run: gh auth login -h github.com"
  exit 1
fi

declare -a PAIRS=(
  "DataLuminary:dataluminary"
  "blockyEdu:blockyedu"
  "AgentSkillMesh:doerflow"
  "VistaRemote:vistacast"
  "LuminaryIoTChain:syncrobrain"
)

for pair in "${PAIRS[@]}"; do
  current="${pair%%:*}"
  target="${pair##*:}"
  if gh api "orgs/$current" >/dev/null 2>&1; then
    if $WHATIF; then
      echo "[WhatIf] PATCH orgs/$current login=$target"
    else
      read -r -p "Rename $current → $target ? [y/N] " ans
      [[ "$ans" =~ ^[yY] ]] || continue
      gh api -X PATCH "orgs/$current" -f "login=$target"
      echo "✓ $current → $target"
    fi
  elif gh api "orgs/$target" >/dev/null 2>&1; then
    echo "✓ $target already exists"
  else
    echo "✗ $current not found"
  fi
done

echo "Next: ./scripts/update-git-remotes.ps1 or update remotes manually"
