#!/usr/bin/env bash
# One-command public demo on a fresh Ubuntu 22.04/24.04 cloud machine (1 GB RAM is enough).
# Run:  curl -fsSL https://raw.githubusercontent.com/raohimanshu2025-source/SCOS-Claude/main/cityos-dx/deploy/setup-public-demo.sh | sudo bash
# Optional: DX_DOMAIN=demo.example.in (your own domain pointing at this machine). Without it, <ip>.sslip.io is used.
# Demo data only. This is not a live, certified or approved city system.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Please run as root: put sudo in front, e.g.  curl -fsSL <link> | sudo bash"; exit 1; }
REPO=${REPO:-https://github.com/raohimanshu2025-source/SCOS-Claude.git}
BRANCH=${BRANCH:-main}
DIR=/opt/cityos-dx
IP=$(curl -fsS https://api.ipify.org)
DX_DOMAIN=${DX_DOMAIN:-${IP//./-}.sslip.io}
echo "== Setting up the City OS demo at https://$DX_DOMAIN"

# Small machines (1 GB, such as Azure B1s): add swap so the Docker build and the server have room.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 certbot git openssl >/dev/null
systemctl enable --now docker >/dev/null

mkdir -p "$DIR/tls"
if [ -d "$DIR/src/.git" ]; then git -C "$DIR/src" pull -q; else git clone -q --depth 1 -b "$BRANCH" "$REPO" "$DIR/src"; fi

# Web certificate from Let's Encrypt, copied where the container (user 1000) can read it, and renewed automatically.
cat > /etc/letsencrypt-copy.sh <<HOOK
#!/bin/sh
cp -L /etc/letsencrypt/live/$DX_DOMAIN/fullchain.pem /etc/letsencrypt/live/$DX_DOMAIN/privkey.pem $DIR/tls/
chown 1000:1000 $DIR/tls/*.pem; chmod 600 $DIR/tls/privkey.pem
HOOK
chmod +x /etc/letsencrypt-copy.sh
certbot certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email -d "$DX_DOMAIN" --deploy-hook /etc/letsencrypt-copy.sh \
  || { echo "Could not get the web certificate. Check that ports 80 and 443 are open to the internet (on Azure: VM > Networking > inbound port rules), then run this again."; exit 1; }
/etc/letsencrypt-copy.sh

# Demo logins: one shared password for the demo accounts, a separate one for the administrator.
if [ ! -f "$DIR/logins.txt" ]; then
  GUEST="Demo-$(openssl rand -hex 4)-2026"; ADMIN="Admin-$(openssl rand -hex 8)-9"
  printf 'DX_DOMAIN=%s\nDX_SEED_PASSWORD=%s\nDX_SEED_ADMIN_PASSWORD=%s\n' "$DX_DOMAIN" "$GUEST" "$ADMIN" > "$DIR/.env"; chmod 600 "$DIR/.env"
  printf 'Demo site: https://%s\nDemo accounts (give these to officials): officer.transport, officer.wd, officer.pcc, officer.cs, officer.mc, control, planner, analyst, developer, auditor\nDemo password: %s\nAdministrator (keep private): admin / %s\n' "$DX_DOMAIN" "$GUEST" "$ADMIN" > "$DIR/logins.txt"; chmod 600 "$DIR/logins.txt"
fi

cd "$DIR/src/cityos-dx"
docker compose --env-file "$DIR/.env" -f deploy/docker-compose.yml -f deploy/docker-compose.public.yml up -d --build
echo; cat "$DIR/logins.txt"
echo; echo "Reset the demo to its starting state:  cd $DIR/src/cityos-dx && docker compose --env-file $DIR/.env -f deploy/docker-compose.yml -f deploy/docker-compose.public.yml down -v && docker compose --env-file $DIR/.env -f deploy/docker-compose.yml -f deploy/docker-compose.public.yml up -d"
