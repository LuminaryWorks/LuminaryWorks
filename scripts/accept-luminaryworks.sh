#!/usr/bin/env bash
# One-click acceptance: health + IdP password login for enabled products.
# Also run after install.sh (unless --skip-accept). Safe to re-run anytime.
set -euo pipefail
KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$KIT_DIR/install-runtime.py" --kit "$KIT_DIR" --accept
