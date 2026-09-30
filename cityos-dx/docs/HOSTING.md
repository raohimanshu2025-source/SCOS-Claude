# Hosting a public demo for officials

This puts the server on the internet so officials can open a link in their browser and log in with demo accounts. It runs on **demo data only**. It is not a live, certified or approved city system.

## What you need

- A small cloud machine running Ubuntu 22.04 or 24.04, with 1 GB of memory and a public IP address. Any provider works.
- Ports 80 and 443 open to the internet. Port 80 is only used to get and renew the web certificate.
- Optional: your own domain name pointing at the machine. Without one, the script uses a free `<ip>.sslip.io` name.

## Set it up (one command)

Open the machine's console as root and run:

```sh
curl -fsSL https://raw.githubusercontent.com/raohimanshu2025-source/SCOS-Claude/main/cityos-dx/deploy/setup-public-demo.sh | bash
```

To use your own domain: `DX_DOMAIN=demo.example.in bash setup-public-demo.sh`.

The script does the following:

1. Installs Docker and certbot.
2. Gets a free web certificate from Let's Encrypt, so browsers show no warning. It renews by itself.
3. Starts the server on port 443 with the demo city.
4. Prints the link and the logins. They are kept in `/opt/cityos-dx/logins.txt`.

## Logins

| Give to officials | Role |
|---|---|
| `officer.transport`, `officer.wd`, `officer.pcc`, `officer.cs`, `officer.mc` | Department data officers (provider console) |
| `control` | Control room operator |
| `planner`, `developer` | Data users |
| `analyst` | Analytics provider |
| `auditor` | Read-only audit |

All of these share one demo password. Keep `admin` for yourself: it has its own password, and it can pause services and manage accounts.

## Reset after a meeting

Officials may change policies or data during a demo. To go back to the starting state:

```sh
cd /opt/cityos-dx/src/cityos-dx
docker compose --env-file /opt/cityos-dx/.env -f deploy/docker-compose.yml -f deploy/docker-compose.public.yml down -v
docker compose --env-file /opt/cityos-dx/.env -f deploy/docker-compose.yml -f deploy/docker-compose.public.yml up -d
```

## How it works

- The server itself answers on port 443. There is no proxy in front of it, so client certificates (mutual TLS, BIS 5.1) still reach it.
- Browsers are shown the Let's Encrypt certificate, set with `DX_PUBLIC_TLS_CERT` and `DX_PUBLIC_TLS_KEY`. The server checks the files every hour and picks up a renewed certificate without a restart.
- Client certificates are still checked against the DX CA and any configured licensed CAs.
- The demo passwords are set with `DX_SEED_PASSWORD` and `DX_SEED_ADMIN_PASSWORD`, only when the city is first seeded.

## Before any real use

The steps in [OPERATIONS.md](OPERATIONS.md) still apply: a security audit, certificates from a licensed CA, government hosting, data agreements and formal approval.
