# Hosting a public demo for officials

This puts the server on the internet so officials can open a link in their browser and log in with demo accounts. It runs on **demo data only**. It is not a live, certified or approved city system.

## What you need

- A small cloud machine running Ubuntu 22.04 or 24.04, with 1 GB of memory and a public IP address. Any provider works.
- Ports 80 and 443 open to the internet. Port 80 is only used to get and renew the web certificate. Port 8883 too if MQTT streams are wanted.
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
3. Starts the server on port 443 with the Kanpur departments and synthetic demo data (or the made-up Demo City with `DX_CITY_PROFILE=demo`).
4. Prints the link and the logins. They are kept in `/opt/cityos-dx/logins.txt`.

## On Oracle Cloud free tier (always on, no monthly bill)

Oracle's "Always Free" machines keep running without a bill. Sign-up asks for a card to check who you are. Screens change from time to time, so the names below may differ slightly.

1. Sign up at https://www.oracle.com/cloud/free/. Choose your **home region** carefully, because it cannot be changed later. **India West (Mumbai)** or **India South (Hyderabad)** are closest.
2. In the console: **Compute > Instances > Create instance**.
   - Name: `cityos-demo`.
   - Image: **Canonical Ubuntu 24.04** (or 22.04).
   - Shape: **Ampere > VM.Standard.A1.Flex** with 1 OCPU and 6 GB memory. This is inside the free limits, and the site is light. If it says "out of capacity", try again later, try another availability domain, or pick **VM.Standard.E2.1.Micro** (also Always Free, 1 GB).
   - Networking: let it **create a new virtual cloud network** with a **public subnet**, and keep **Assign a public IPv4 address** on.
   - SSH keys: **Generate a key pair for me**, and download the private key. Keep it safe.
   - Click **Create** and wait until the state is **Running**. Copy the **Public IP address**.
3. Open the ports in Oracle's own firewall. On the instance page, open the **Subnet**, then its **Security List**, then **Add Ingress Rules**. Add three rules, each with source `0.0.0.0/0`, IP protocol **TCP**, and destination port **80**, **443** and **8883**.
4. Connect to the machine. Click **Cloud Shell** (the `>_` icon), upload the private key with the menu (gear icon > Upload), then run:
   `chmod 600 <key file>` and `ssh -i <key file> ubuntu@<public IP>`
   From your own computer you can use PowerShell or Terminal with the same `ssh` command.
5. Run the one command above. It already has `sudo`, and it also opens ports 80, 443 and 8883 inside the machine, which Oracle's Ubuntu image blocks by default. It sets up the Kanpur departments (synthetic data); add `DX_CITY_PROFILE=demo` after `sudo` for the made-up Demo City instead.
6. Copy the printed link and logins. Give officials only the demo password, never the administrator one.

Oracle may reclaim Always Free machines that stay almost idle for about a week (check its current Always Free rules). Opening the site now and then keeps it in use.

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
2. In the terminal at the bottom, run `bash cityos-dx/deploy/start-codespace.sh`. It prints the link and the logins (also kept in `~/cityos-dx-state/logins.txt`). In Codespaces the site uses the Kanpur profile (11 Kanpur departments, synthetic demo data). For the old made-up Demo City, run `DX_CITY_PROFILE=demo bash cityos-dx/deploy/start-codespace.sh` with an empty state folder.
3. The script makes port 8080 public by itself when GitHub allows it, and says so. If it says the link is still private: press Ctrl+J if no panel shows, open the **PORTS** tab, right-click port **8080**, choose **Port Visibility > Public**. (Port 8080 is a small plain-HTTP front door to the server on 8443, so GitHub's forwarding needs no protocol setting.)
4. Keep the browser tab open during the demo. Press Ctrl+C to stop. Next time, open the same codespace from **Code > Codespaces** and run step 2 again; the data and passwords are kept.

The link opens the public portal (dashboards anyone can see). Officials click **Officer login** at the top right to use their logins.

Through the Codespaces link, people use the website with their logins as usual. Machine-to-machine API calls with client certificates (BIS 5.1 mutual TLS) do not pass through the Codespaces link; use a cloud machine for those.

## Logins

**Kanpur profile** (the Codespaces default, or set `DX_CITY_PROFILE=kanpur` before seeding):

| Give to officials | Role |
|---|---|
| `officer.<dept>` | The department's data officer: publishes datasets, adds data, sets who may see it, approves or refuses requests |
| `staff.<dept>` | Department staff: searches the catalogue, asks for data, reads what is allowed |
| `control` | ICCC control room: dashboard, analytics and alerts |
| `analyst`, `developer` | Analytics provider and app developer |
| `auditor` | Read-only audit |

`<dept>` is one of `knn` (Nagar Nigam), `kjs` (Jal Sansthan), `kesco` (KESCO), `traffic` (Traffic Police), `fire` (Fire Service), `cmo` (CMO health), `kda` (KDA), `pwd` (PWD), `uppcb` (UPPCB), `kctsl` (City Transport), `iccc` (ICCC control room).

**Demo City profile** (the default elsewhere):

| Give to officials | Role |
|---|---|
| `officer.transport`, `officer.wd`, `officer.pcc`, `officer.cs`, `officer.mc` | Department data officers (provider console) |
| `control` | Control room operator |
| `planner`, `developer` | Data users |
| `analyst` | Analytics provider |
| `auditor` | Read-only audit |

All of these share one demo password. Keep `admin` for yourself: it has its own password, and it can pause services and manage accounts.

## Reset after a meeting

Officials may change policies or data during a demo. In Codespaces, press Ctrl+C, then run `rm -rf ~/cityos-dx-state && bash cityos-dx/deploy/start-codespace.sh` (this also makes new passwords). On a server:

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
