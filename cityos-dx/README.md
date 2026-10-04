# City OS Data Exchange: reference implementation

Working software that implements two documents, and nothing else:

1. **BIS draft IS 18XXXX-X (Part 1):2019**, *Unified Digital Infrastructure – Data Exchange Reference Architecture* v0.9 (Bureau of Indian Standards, draft for comment).
2. **City Operating System and City Intelligence Layer**, v1.1, 27 July 2023.

> **Status.** This is a research reference implementation. It runs on **synthetic demo data** for a made-up "Demo City". It is **not** an official, certified, audited or live city system, and it has not been approved by any authority. Using it with real city data needs the steps in [docs/OPERATIONS.md](docs/OPERATIONS.md#before-real-use) first.

## What it does

| Part | What is real |
|---|---|
| Certificate authority (BIS 5.4.2) | Real X.509 certificates from an OpenSSL root CA and DX CA, in the DX classes; certificate requests with the "Certificate request" subject, white-listed organisations and domain matching; revocation with a real CRL and a status endpoint |
| Identity (BIS 4.4, 5.1) | Mutual TLS: API clients present their certificate; officers log in to the console with a password linked to their certificate; OpenID Connect style ID tokens (EdDSA) for citizens (public data only, since BIS 5.4.2 requires a certificate for anything else); certificates from configured licensed CAs |
| Catalogue (BIS 4.5.1, 6) | JSON-LD items checked against Tables 5-8; text, attribute, geo and time search; data models with units; change notices |
| Authorization (BIS 4.5.2, 5.2-5.4, 7) | Policies P = (C, A) with Table 3 and 4 values; class checks; consent requests; licence agreements; tokens `auth-server/consumer/hex`, bound to the consumer's certificate; introspection by class 1 resource servers only; revocation |
| Resource access (BIS Table 2) | Latest, search, status, count, subscribe/update/unsubscribe (server-sent events), GeoJSON download, provider ingestion checked against the data model, views without personal data, a DX Adapter in front of a legacy (non-compliant) server |
| City Intelligence Layer (City OS 3-4) | 23 domain APIs across the six domains (including the Figure 7 multimodal transit APIs), OpenAPI descriptions with the Figure 12 ontology, pluggable analytics with schema matching, scheduler, alerts, OLAP, keyword questions, monthly ICCC report, NGSI-LD output, federation between cities |
| Operations (BIS 5.5-5.6) | Public status page and heartbeat, per-interface statistics, hash-chained Ed25519-signed audit log, online backups with integrity check, restore, uptime probe, service drills |
| Console | A web console for officers (admin, data officer, consumer, ICCC operator, auditor, analytics provider) that calls the same API |

No npm packages are used: only Node.js 22 built-ins (`node:sqlite`, `node:crypto`, `node:https`, `node:test`) and the `openssl` command line tool.

## Quick start

```sh
# Node.js 22.13 or later and openssl 3 on the PATH
npm run certs        # creates pki/: root CA, DX CA, server certificate, audit key
npm run seed         # creates data/dx.sqlite with the demo city; passwords in data/initial-passwords.txt
npm start            # https://localhost:8443
```

Open https://localhost:8443 and log in (for example as `admin`). Your browser will warn about the certificate until you trust `pki/root/root.crt`. Each account must change its password at first login.

API clients use the certificates in `pki/clients/`, for example:

```sh
curl --cacert pki/root/root.crt https://localhost:8443/status/v1/heartbeat
curl --cacert pki/root/root.crt \
     --cert pki/clients/control@mc.demo-city.example.crt --key pki/clients/control@mc.demo-city.example.key \
     -X POST -H 'content-type: application/json' -d '{"request":[{"id":"urn:demo-cat:drains/drain-1"}]}' \
     https://localhost:8443/auth/v1/token
```

The default seed is a made-up "Demo City". For Kanpur department names with synthetic demo data, run `DX_CITY_PROFILE=kanpur npm run seed` and start with the same variable set (see `docs/HOSTING.md` for the logins). The Kanpur profile is our addition, not part of the two documents.

With Docker: `docker compose -f deploy/docker-compose.yml up -d --build`.

## Tests

```sh
npm test             # 85 tests; each starts a fresh city and talks to it over HTTPS with client certificates
npm run test:report  # also writes docs/TEST_REPORT.md with coverage and requirement traceability
npm run trace        # then updates the "server" status of every point in docs/requirements.json
```

Test titles carry the requirement point IDs (`[BIS-58]`, `[COS-23]`) from [docs/requirements.json](docs/requirements.json), the same list used in the verification PDF. Current result for 162 points: 141 working and tested, 9 partly met, 1 not met (BIS-111 trusted execution environments), 8 statements with no function, 3 out of scope in the documents. See [docs/DOCUMENT_CONFORMANCE.md](docs/DOCUMENT_CONFORMANCE.md) for what matches, what differs and what we added.

To put a demo online for officials, see [docs/HOSTING.md](docs/HOSTING.md): one command on a small cloud machine, with a free web certificate and demo logins.

## Documents

- [docs/USER_MANUAL.md](docs/USER_MANUAL.md): how officers use the console, by role.
- [docs/TECHNICAL.md](docs/TECHNICAL.md): architecture, API reference, data model, security design, mapping to the two documents.
- [docs/SECURITY_CONTROLS.md](docs/SECURITY_CONTROLS.md): self-assessment against ISO/IEC 27001:2022 Annex A technological controls. Not a certification.
- [docs/OPERATIONS.md](docs/OPERATIONS.md): install, backup and restore, uptime monitoring, certificate tasks, and what is needed before real use.
- [docs/TEST_REPORT.md](docs/TEST_REPORT.md): latest test run.

## Licence

Apache License 2.0. See [LICENSE](LICENSE).
