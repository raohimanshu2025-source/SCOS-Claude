#!/usr/bin/env bash
# Start the demo website inside a GitHub Codespace (demo data only; not a live or certified system).
# Run from the codespace terminal:  bash cityos-dx/deploy/start-codespace.sh
# The site runs while the codespace is open. Officials use port 8080 (a plain-HTTP front door to the server on 8443),
# which must be Public; the script makes it public when GitHub allows it.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -n "${CODESPACE_NAME:-}" ] || { echo "This script is for GitHub Codespaces. On a normal server use deploy/setup-public-demo.sh."; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || { echo "Node 22.13 or newer is needed. Rebuild the codespace (it uses the .devcontainer settings) and try again."; exit 1; }
command -v openssl >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq openssl >/dev/null; }

STATE=${DX_STATE:-$HOME/cityos-dx-state}
mkdir -p "$STATE"
export DX_DATA_DIR=$STATE/data DX_PKI_DIR=$STATE/pki DX_BACKUP_DIR=$STATE/backups DX_PORT=8443
export DX_PUBLIC_NAME="$CODESPACE_NAME-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
LINK="https://$DX_PUBLIC_NAME"

if [ ! -f "$STATE/logins.txt" ]; then
  GUEST="Demo-$(openssl rand -hex 4)-7"; ADMIN="Admin-$(openssl rand -hex 8)-9"
  printf 'DX_SEED_PASSWORD=%s\nDX_SEED_ADMIN_PASSWORD=%s\n' "$GUEST" "$ADMIN" > "$STATE/.env"; chmod 600 "$STATE/.env"
fi
# City profile: 'kanpur' (11 Kanpur departments, synthetic demo data) unless DX_CITY_PROFILE=demo is set.
# A state folder made before profiles existed holds the old Demo City data: keep a copy of it and rebuild as Kanpur.
if ! grep -q '^DX_CITY_PROFILE=' "$STATE/.env"; then
  echo "DX_CITY_PROFILE=${DX_CITY_PROFILE:-kanpur}" >> "$STATE/.env"
  if [ -d "$DX_DATA_DIR" ]; then mv "$DX_DATA_DIR" "$STATE/data-before-kanpur-$(date +%Y%m%d%H%M%S)"; fi
fi
set -a; . "$STATE/.env"; set +a
node scripts/init-pki.js >/dev/null
[ -f "$DX_DATA_DIR/dx.sqlite" ] || node --no-warnings src/seed.js >/dev/null
if [ "$DX_CITY_PROFILE" = kanpur ]; then
  ACCOUNTS="officer.<dept> (publishes and shares the department's data) and staff.<dept> (searches and asks for data), where <dept> is
    knn (Nagar Nigam), kjs (Jal Sansthan), kesco (KESCO), traffic (Traffic Police), fire (Fire Service), cmo (CMO health),
    kda (KDA), pwd (PWD), uppcb (UPPCB), kctsl (City Transport), iccc (ICCC control room);
  also control (ICCC dashboard and alerts), analyst, developer, auditor"
else
  ACCOUNTS="officer.transport, officer.wd, officer.pcc, officer.cs, officer.mc, control, planner, analyst, developer, auditor"
fi
printf 'Demo site: %s\nDemo accounts (give these to officials): %s\nDemo password: %s\nAdministrator (keep private): admin / %s\n' \
  "$LINK" "$ACCOUNTS" "$DX_SEED_PASSWORD" "$DX_SEED_ADMIN_PASSWORD" > "$STATE/logins.txt"; chmod 600 "$STATE/logins.txt"

# Start the server and its front door, wait until both answer, then make port 8080 public so officials can open the link.
node --no-warnings src/server.js &
SERVER=$!
node deploy/codespace-proxy.js &
PROXY=$!
trap 'kill $SERVER $PROXY 2>/dev/null' INT TERM EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null -f http://127.0.0.1:8080/ && break; sleep 1; done
PUBLIC_OK=0
if command -v gh >/dev/null; then
  for _ in 1 2 3 4 5; do
    if gh codespace ports visibility 8080:public -c "$CODESPACE_NAME" >/dev/null 2>"$STATE/gh-error.txt"; then PUBLIC_OK=1; break; fi
    # the codespace's built-in token may not be allowed to change ports; try again without it (uses gh auth login, if done)
    if GITHUB_TOKEN= gh codespace ports visibility 8080:public -c "$CODESPACE_NAME" >/dev/null 2>>"$STATE/gh-error.txt"; then PUBLIC_OK=1; break; fi
    sleep 3
  done
fi

echo
echo "================ City OS demo (demo data, not a live system) ================"
cat "$STATE/logins.txt"
if [ "$PUBLIC_OK" = 1 ]; then
  echo "The link is PUBLIC: officials can open it."
else
  echo "The link is still PRIVATE. Make it public in one of these ways:"
  echo "  a) Press Ctrl+J if no panel shows at the bottom, click the PORTS tab, right-click 8080 > Port Visibility > Public."
  echo "  b) Or press Ctrl+C, run:  GITHUB_TOKEN= gh auth login -s codespace   (GitHub.com, HTTPS, log in with a web browser), then run this script again."
  echo "  (details: $STATE/gh-error.txt)"
fi
echo "Keep this window open. Press Ctrl+C to stop the website."
echo "============================================================================="
wait $SERVER
