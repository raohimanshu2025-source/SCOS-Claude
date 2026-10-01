#!/usr/bin/env bash
# Start the demo website inside a GitHub Codespace (demo data only; not a live or certified system).
# Run from the codespace terminal:  bash cityos-dx/deploy/start-codespace.sh
# The site runs while the codespace is open. Make port 8443 Public in the Ports tab so officials can open the link.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -n "${CODESPACE_NAME:-}" ] || { echo "This script is for GitHub Codespaces. On a normal server use deploy/setup-public-demo.sh."; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || { echo "Node 22.13 or newer is needed. Rebuild the codespace (it uses the .devcontainer settings) and try again."; exit 1; }
command -v openssl >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq openssl >/dev/null; }

STATE=${DX_STATE:-$HOME/cityos-dx-state}
mkdir -p "$STATE"
export DX_DATA_DIR=$STATE/data DX_PKI_DIR=$STATE/pki DX_BACKUP_DIR=$STATE/backups DX_PORT=8443
export DX_PUBLIC_NAME="$CODESPACE_NAME-8443.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
LINK="https://$DX_PUBLIC_NAME"

if [ ! -f "$STATE/logins.txt" ]; then
  GUEST="Demo-$(openssl rand -hex 4)-7"; ADMIN="Admin-$(openssl rand -hex 8)-9"
  printf 'DX_SEED_PASSWORD=%s\nDX_SEED_ADMIN_PASSWORD=%s\n' "$GUEST" "$ADMIN" > "$STATE/.env"; chmod 600 "$STATE/.env"
fi
set -a; . "$STATE/.env"; set +a
node scripts/init-pki.js >/dev/null
[ -f "$DX_DATA_DIR/dx.sqlite" ] || node --no-warnings src/seed.js >/dev/null
printf 'Demo site: %s\nDemo accounts (give these to officials): officer.transport, officer.wd, officer.pcc, officer.cs, officer.mc, control, planner, analyst, developer, auditor\nDemo password: %s\nAdministrator (keep private): admin / %s\n' \
  "$LINK" "$DX_SEED_PASSWORD" "$DX_SEED_ADMIN_PASSWORD" > "$STATE/logins.txt"; chmod 600 "$STATE/logins.txt"

# Try to make the link public; if this is not allowed, do it by hand in the Ports tab.
PUBLIC_OK=0
command -v gh >/dev/null && gh codespace ports visibility 8443:public -c "$CODESPACE_NAME" >/dev/null 2>&1 && PUBLIC_OK=1

echo
echo "================ City OS demo (demo data, not a live system) ================"
cat "$STATE/logins.txt"
[ "$PUBLIC_OK" = 1 ] || echo "STEP NEEDED: open the PORTS tab, right-click port 8443 > Port Visibility > Public."
echo "Keep this window open. Press Ctrl+C to stop the website."
echo "============================================================================="
exec node --no-warnings src/server.js
