# Operations guide

For the people who install and run the server. All data in the demo city is synthetic.

## 1. Requirements

- Linux server with Node.js 22.13 or later and OpenSSL 3, or Docker.
- One open TCP port (default 8443).
- A DNS name for the server. Set `DX_PUBLIC_NAME` to it before creating the PKI.

## 2. Install

### With Docker

```sh
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps        # dx should say "healthy"
```

State (database, PKI, backups) lives in the `dx-state` volume. On first start the container creates the PKI and seeds the demo city. The initial passwords are in `/var/lib/cityos-dx/data/initial-passwords.txt` inside the volume. A second container takes a backup every day and keeps 14.

### With systemd

```sh
sudo useradd --system --home /opt/cityos-dx cityos
sudo cp -r . /opt/cityos-dx && sudo mkdir -p /var/lib/cityos-dx && sudo chown cityos /var/lib/cityos-dx
cd /opt/cityos-dx
sudo -u cityos env DX_PKI_DIR=/var/lib/cityos-dx/pki DX_PUBLIC_NAME=dx.your-city.example node scripts/init-pki.js
sudo -u cityos env DX_DATA_DIR=/var/lib/cityos-dx/data DX_PKI_DIR=/var/lib/cityos-dx/pki node --no-warnings src/seed.js
sudo cp deploy/*.service deploy/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cityos-dx.service cityos-dx-backup.timer
```

Put other settings in `/etc/cityos-dx.env` (see TECHNICAL.md section 7). The unit runs with `NoNewPrivileges`, `ProtectSystem=strict` and `ProtectHome`.

## 3. First steps after install

1. Log in as `admin` with the initial password and choose a new one. Do the same for every account, then delete `initial-passwords.txt`.
2. Give browsers the root certificate `pki/root/root.crt` (or use a certificate from a public CA, section 8).
3. Check `https://<server>:8443/status/v1/heartbeat` shows every service up.
4. Check **Operations and audit** says the audit chain verifies.

## 4. Backups and restore

- **Take a backup now:** `node --no-warnings scripts/backup.js manual`, or the button in the console. Backups go to `DX_BACKUP_DIR`, are readable only by the owner, and are checked for integrity. `DX_BACKUP_KEEP` (default 14) sets how many are kept.
- **Daily backups:** the systemd timer runs at 02:30; the Docker setup runs one every 24 hours.
- **Copy backups off the server.** Also back up `pki/` separately and keep it secret: it holds the CA keys and the audit signing key. Without the audit key, restore cannot check the audit chain.
- **Restore:**
  ```sh
  sudo systemctl stop cityos-dx
  sudo -u cityos node --no-warnings scripts/restore.js /var/lib/cityos-dx/backups/<file>.sqlite
  sudo systemctl start cityos-dx
  ```
  The script refuses a backup that fails the integrity check or whose audit chain does not verify. The old database is kept as `dx.sqlite.before-restore-<time>`.
- **Test a restore** on a spare machine at least once a month.

## 5. Monitoring

- Run the uptime probe from another machine every minute and alert when it exits non-zero:
  ```sh
  DX_URL=https://dx.your-city.example:8443 DX_CA_FILE=root.crt node scripts/uptime-check.js
  ```
- The public status page `/status/v1` shows uptime and latency per service for the last 24 hours.
- `/ops/v1/stats` (admin, auditor) shows counts of tokens, consents and certificates.
- Check `/ops/v1/audit/verify` daily. A failure means the database was changed outside the server.

## 6. Certificate tasks

- **Approve a request:** console, Certificates and trust, then enter the request id and press Approve and issue. The certificate is sent back through `GET /identity/v1/csr/status`.
- **Revoke:** enter serial and reason. The CRL updates at once. Publish `/identity/v1/crl.pem` wherever resource servers fetch it.
- **Renew the server certificate** before it expires: move the old server files out of `pki/server/` and run `node scripts/init-pki.js` again (it only creates what is missing), then restart.
- **Add a department:** register the organisation, white-list it, then approve its organisation certificate request and its officers' requests.
- **Script for departments (BIS 5.4.2):** give a department `scripts/org-certificates.js`. With its organisation certificate it lists and decides its own employees' requests: `DX_URL=https://dx.example:8443 DX_CA_FILE=root.crt ORG_CERT=org.crt ORG_KEY=org.key node scripts/org-certificates.js list`, then `approve <id>` or `reject <id> "reason"`.
- **DNS check of resource servers (Figure 2 step 8):** once resource servers have real host names, set `DX_RS_DNS_CHECK=true`. An introspection call from a resource server is then refused unless its certificate's host name resolves to the caller's address.

## 7. Service drills

The admin can pause a service (catalogue, authorization, resource server, notification) from the console to rehearse the failure cases of BIS 5.6, then resume it. Resume every service after a drill; the status page records the downtime.

## Before real use

The software is tested, but a city cannot use it for real data until these steps are done. None of them can be done by the software team alone.

| Step | Who | Why |
|---|---|---|
| Certificates from a licensed certifying authority (under the Controller of Certifying Authorities) or the city's approved CA, with CA keys in a hardware security module | City IT, CA | The demo CA keys are files on disk |
| Hosting in an approved data centre or government cloud, with firewall, backups off site and NTP | City IT | Operator controls in SECURITY_CONTROLS.md |
| Independent security audit, vulnerability assessment and penetration test (for example by a CERT-In empanelled auditor) | City, auditor | Required before a government system goes live |
| Data protection review under the Digital Personal Data Protection Act, 2023, and a data sharing policy | City legal | Consent, retention and purpose rules for personal data |
| Agreements with each department for live data feeds, and turning off the simulator (`DX_SIMULATOR=false`) and demo data | Departments | The demo city data is synthetic |
| High availability (second instance, database replication) if the service must stay up during failures | City IT | This build is a single process |
| Formal approval by the competent authority | City | Only the city can approve the system |

Until then the system must be described as a research reference implementation with demo data.
