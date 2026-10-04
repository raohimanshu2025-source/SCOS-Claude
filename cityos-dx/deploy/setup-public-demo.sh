#!/usr/bin/env bash
# One-command public demo on a fresh Ubuntu 22.04/24.04 cloud machine (1 GB RAM is enough; x86 or Arm, e.g. Oracle Cloud free tier).
# Run:  curl -fsSL https://raw.githubusercontent.com/raohimanshu2025-source/SCOS-Claude/main/cityos-dx/deploy/setup-public-demo.sh | sudo bash
# Optional: DX_DOMAIN=demo.example.in (your own domain pointing at this machine). Without it, <ip>.sslip.io is used.
# Optional: DX_CITY_PROFILE=demo for the made-up Demo City instead of the Kanpur departments (synthetic data either way).
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
# Oracle Cloud Ubuntu images block every port except 22 inside the machine as well: open 80 (certificate check),
# 443 (the site) and 8883 (MQTT) and keep the rules after a restart. The cloud's own security list must allow them too.
if iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
  for p in 80 443 8883; do
    iptables -C INPUT -p tcp -m state --state NEW --dport $p -j ACCEPT 2>/dev/null && continue
    n=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')  # just before the reject-all rule
    iptables -I INPUT "${n:-1}" -p tcp -m state --state NEW --dport $p -j ACCEPT
  done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
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
  || { echo "Could not get the web certificate. Check that ports 80 and 443 are open to the internet (on Oracle Cloud: Networking > Virtual cloud networks > your network > Security lists > add ingress rules for TCP 80, 443 and 8883 from 0.0.0.0/0; on Azure: VM > Networking > inbound port rules), then run this again."; exit 1; }
/etc/letsencrypt-copy.sh

# Demo logins: one shared password for the demo accounts, a separate one for the administrator.
if [ ! -f "$DIR/logins.txt" ]; then
  GUEST="Demo-$(openssl rand -hex 4)-2026"; ADMIN="Admin-$(openssl rand -hex 8)-9"
  printf 'DX_DOMAIN=%s\nDX_CITY_PROFILE=%s\nDX_SEED_PASSWORD=%s\nDX_SEED_ADMIN_PASSWORD=%s\n' "$DX_DOMAIN" "${DX_CITY_PROFILE:-kanpur}" "$GUEST" "$ADMIN" > "$DIR/.env"; chmod 600 "$DIR/.env"
  if [ "${DX_CITY_PROFILE:-kanpur}" = kanpur ]; then
    ACCOUNTS="officer.<dept> and staff.<dept> for knn, kjs, kesco, traffic, fire, cmo, kda, pwd, uppcb, kctsl, iccc; also control, analyst, developer, auditor"
  else
    ACCOUNTS="officer.transport, officer.wd, officer.pcc, officer.cs, officer.mc, control, planner, analyst, developer, auditor"
  fi
  printf 'Demo site: https://%s\nDemo accounts (give these to officials): %s\nDemo password: %s\nAdministrator (keep private): admin / %s\n' "$DX_DOMAIN" "$ACCOUNTS" "$GUEST" "$ADMIN" > "$DIR/logins.txt"; chmod 600 "$DIR/logins.txt"
fi

cd "$DIR/src/cityos-dx"
docker compose --env-file "$DIR/.env" -f deploy/docker-compose.yml -f deploy/docker-compose.public.yml up -d --build
echo; cat "$DIR/logins.txt"
echo; echo "Reset the demo to its starting state:  cd $DIR/src/cityos-dx && docker compose --env-file $DIR/.env -f deploy/docker-compose.yml -f deploy/docker-compose.public.yml down -v && docker compose --env-file $DIR/.env -f deploy/docker-compose.yml -f deploy/docker-compose.public.yml up -d"
