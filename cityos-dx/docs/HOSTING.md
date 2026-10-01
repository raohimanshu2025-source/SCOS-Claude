# Hosting a public demo for officials

This puts the server on the internet so officials can open a link in their browser and log in with demo accounts. It runs on **demo data only**. It is not a live, certified or approved city system.

## What you need

- A small cloud machine running Ubuntu 22.04 or 24.04, with 1 GB of memory and a public IP address. Any provider works.
- Ports 80 and 443 open to the internet. Port 80 is only used to get and renew the web certificate.
- Optional: your own domain name pointing at the machine. Without one, the script uses a free `<ip>.sslip.io` name.

## Set it up (one command)

Open the machine's console and run:

```sh
curl -fsSL https://raw.githubusercontent.com/raohimanshu2025-source/SCOS-Claude/main/cityos-dx/deploy/setup-public-demo.sh | sudo bash
```

To use your own domain: `curl -fsSL <same link> | sudo DX_DOMAIN=demo.example.in bash`.

The script does the following:

1. Installs Docker and certbot.
2. Gets a free web certificate from Let's Encrypt, so browsers show no warning. It renews by itself.
3. Starts the server on port 443 with the demo city.
4. Prints the link and the logins. They are kept in `/opt/cityos-dx/logins.txt`.

## On Azure for Students (free credit, no card)

1. Sign up at https://azure.microsoft.com/free/students with your college e-mail.
2. In the Azure portal: **Create a resource > Virtual machine**.
   - Subscription: Azure for Students. Resource group: create new, e.g. `cityos`.
   - Virtual machine name: `cityos-demo`. Region: **(Asia Pacific) Central India**.
   - Image: **Ubuntu Server 24.04 LTS - x64 Gen2**.
   - Size: **Standard_B1s** (1 GB). The script adds swap on small machines. B1ms or B2s also work.
   - Authentication type: **Password**. Username: `azureuser`. Choose a strong password.
   - Public inbound ports: **Allow selected ports**, and tick **SSH (22), HTTP (80), HTTPS (443)**.
   - Click **Review + create**, then **Create**. Wait for "Your deployment is complete".
3. Click **Go to resource** and copy the **Public IP address**.
4. Open **Cloud Shell** (the `>_` icon at the top of the portal), choose **Bash**, and run `ssh azureuser@<public IP>`. Type `yes`, then your password.
5. Run the one command above (it already has `sudo`).

If the certificate step fails, open the VM's **Networking** page and check that inbound rules allow ports 80 and 443 from Any. Stop the VM from the portal when you do not need it, to save credit (the IP may change after a stop unless you make it static).

## Without a cloud machine: GitHub Codespaces (for a meeting or demo)

Use this when no cloud machine is available. Codespaces is free in the GitHub Student Developer Pack and needs no card. The site runs only while the codespace is open, and the link can change between codespaces.

1. On the repository page on GitHub, click **Code > Codespaces > Create codespace on main**. Wait until the editor opens.
2. In the terminal at the bottom, run `bash cityos-dx/deploy/start-codespace.sh`. It prints the link and the logins (also kept in `~/cityos-dx-state/logins.txt`).
3. Open the **PORTS** tab, right-click port **8443**, choose **Port Visibility > Public**. Now officials can open the link.
4. Keep the browser tab open during the demo. Press Ctrl+C to stop. Next time, open the same codespace from **Code > Codespaces** and run step 2 again; the data and passwords are kept.

Through the Codespaces link, people use the website with their logins as usual. Machine-to-machine API calls with client certificates (BIS 5.1 mutual TLS) do not pass through the Codespaces link; use a cloud machine for those.

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
