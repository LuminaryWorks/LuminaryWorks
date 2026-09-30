#!/usr/bin/env bash
# Complete cf-monitor deploy after Analytics Engine is enabled in the dashboard.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="${PATH}:/Users/andyzhou/.nvm/versions/node/v24.19.0/bin"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  export CLOUDFLARE_API_TOKEN="$(node -e "
const fs=require('fs');
const p=require('os').homedir()+'/Library/Preferences/.wrangler/config/default.toml';
const t=fs.readFileSync(p,'utf8');
const m=t.match(/oauth_token\\s*=\\s*\\\"([^\\\"]+)\\\"/);
if(!m){console.error('No wrangler oauth token; run: npx wrangler login'); process.exit(1);}
process.stdout.write(m[1]);
")"
fi

node scripts/fix-wrangler-paths.mjs
npx cf-monitor config validate
# Embed YAML then fix path (CLI may rewrite config)
npx cf-monitor deploy || true
node scripts/fix-wrangler-paths.mjs
npx wrangler deploy -c .cf-monitor/wrangler.jsonc
npx cf-monitor config sync || true

ADMIN_TOKEN="$(openssl rand -hex 32)"
printf '%s' "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN -c .cf-monitor/wrangler.jsonc

echo ""
echo "Deployed. Save ADMIN_TOKEN securely (shown once):"
echo "$ADMIN_TOKEN"
echo ""
echo "Next:"
echo "  npm run status"
echo "  curl https://cf-monitor.<your-subdomain>.workers.dev/_health"
