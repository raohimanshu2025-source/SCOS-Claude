# Technical document

Reference implementation of the BIS Data Exchange Reference Architecture (draft v0.9, 2019) and the City Operating System and City Intelligence Layer document (v1.1, 2023). All data is synthetic. This is not an official, certified or live system.

## 1. Architecture

One Node.js 22 process serves the whole City OS over HTTPS. Each part keeps to the role the documents give it and talks to the others only through the same functions the API exposes.

```
               officers (browser console)          apps, resource servers (client certificates)
                          \                                   /
                           ------------ HTTPS, TLS 1.2+ ------
                                         |
   +-------------------------------------+--------------------------------------+
   | Identity      | Catalogue  | Authorization | Resource access | Notify     |
   | CA, CRL,      | JSON-LD    | policies,     | latest/search/  | inbox,     |   Data Exchange
   | accounts,     | items,     | consent,      | subscribe/      | change     |   (BIS)
   | ID tokens     | search     | tokens        | ingest, adapter | notices    |
   +---------------+------------+---------------+-----------------+------------+
   | City Intelligence Layer: 19 domain APIs, plugged analytics, scheduler,    |   CIL
   | alerts, OLAP, questions, ICCC report, NGSI-LD output, federation          |   (City OS)
   +---------------------------------------------------------------------------+
   | Operations: signed audit log, status page, heartbeat, backups, drills     |
   +---------------------------------------------------------------------------+
   | SQLite database (node:sqlite, WAL)      | PKI files (OpenSSL CA)          |
   +---------------------------------------------------------------------------+
```

The City Intelligence Layer reads city data only through the Data Exchange, as the City OS document requires ("COS = DX + CIL"). Its service identity (`cil@mc.demo-city.example`, class 5) must hold a token for non-public items, and a caller of a CIL API must also be allowed to read every non-public input.

### Source layout

| Path | Contents |
|---|---|
| `src/server.js` | HTTPS server, routing, principal resolution, rate limit, security headers |
| `src/config.js` | Settings from environment variables (section 7) |
| `src/db.js` | Database schema |
| `src/audit.js` | Hash-chained, Ed25519-signed audit log |
| `src/identity/ca.js` | Root CA and DX CA with `openssl ca`: issue, revoke, CRL, chain check |
| `src/identity/identity.js` | Organisations, white-list, certificate requests, principals, ID tokens |
| `src/identity/accounts.js` | Console accounts, scrypt passwords, sessions, lockout |
| `src/dx/model.js` | JSON-LD context, item types, data models, validation (BIS Tables 5-8) |
| `src/dx/catalogue.js` | Catalogue storage and search |
| `src/dx/authz.js` | Policies, consent, licences, tokens, introspection |
| `src/dx/resource.js` | Resource servers, reads, ingest, subscriptions, legacy adapter |
| `src/dx/notify.js` | Notification service with queued delivery |
| `src/cil/*.js` | Ontology, the 19 analytics, the CIL runtime |
| `src/ops/ops.js` | Heartbeats, metrics, backups, rate limiter, security headers |
| `src/seed.js`, `src/simulate.js` | Demo city and its simulated sensor feed |
| `public/` | Officer console (plain HTML, CSS and JS, no inline code) |
| `scripts/` | PKI setup, backup, restore, uptime probe, test report |
| `deploy/` | Dockerfile, docker compose file, systemd units |
| `test/` | 73 end-to-end tests |

## 2. Identity and authentication

**Certificate authority (BIS 5.4.2, 7.1).** `npm run certs` makes a self-signed root CA, a DX CA signed by it, and a server certificate. The DX CA issues certificates with `openssl ca`, so it keeps a real `index.txt`, serial file and CRL. Each certificate carries a class policy OID (`2.25.228127155926915386208736734112418384017.<class>`) and the matching key usage.

| Kind | Classes | Rule |
|---|---|---|
| `rs` (resource server) | 1 | CN must be a DNS name under the organisation's domain |
| `org` | 2, 3, 4, 5 | Organisation must be white-listed |
| `officer` (data officer) | 3 | Organisation must hold a valid organisation certificate |
| `emp` (employee) | 2, 4, 5 | Same |
| `ind` (individual) | 2 | E-mail domain must match |

A request uses the subject "Certificate request" (the e-mail step of BIS 7.1 is modelled as `POST /identity/v1/csr`). The administrator approves or rejects it. Revocation adds the serial to the CRL, blocks the certificate at once and revokes its tokens.

**How a caller is identified**, in this order:

1. The TLS client certificate. Its serial and fingerprint must be in the database with status valid and not expired, and it must chain to the DX CA.
2. An `X-ID-Token` header: an EdDSA JWT from a trusted OpenID Connect issuer (demo issuer `https://idp.demo-city.example`; more through `DX_OIDC_ISSUERS_FILE`). The audience must be the server's public name.
3. A console session cookie. The session belongs to an account that is linked to a certificate, so console actions run as that certificate holder.
4. Otherwise anonymous (public data and the status page only).

**Console accounts.** Passwords are hashed with scrypt, need at least 12 characters with letters and digits, and must be changed at first login. Five failures lock the account for 15 minutes. The cookie `dx_session` is HttpOnly, Secure and SameSite=Strict, and every write in a session needs the `X-CSRF-Token` header. Roles: admin, provider, consumer, operator, auditor, analytics_provider.

## 3. Authorization (BIS 4.5.2, 5.2-5.4, 7)

Each item has a policy P = (C, A): C is the list of consumers, A the Table 3 attributes. The label sets which certificate classes may read:

| Label | Classes |
|---|---|
| public | any, no token |
| protected | 2, 4, 5 |
| private | 4, 5 |
| confidential | 5 |

`POST /auth/v1/token` checks every requested item. If the caller is in C (or holds a licence from the provider) and has a suitable class, a token is issued. Otherwise the call returns 403 with the list of refused items, and a consent request goes to the provider's inbox.

Tokens have the form `auth.demo-city.example/<consumer e-mail>/<64 hex>` and last `DX_TOKEN_TTL` seconds (default 3600). Only their SHA-256 hash is stored. A token is bound to the certificate that asked for it: another certificate presenting it is refused.

A resource server checks a token with `POST /auth/v1/token/introspect`. Only a class 1 `rs` certificate whose CN matches the item's resource server host may do this. Results are cached briefly and every access is counted (BIS 5.6 flows).

## 4. API reference

All paths are under the server root. Bodies are JSON. Tokens go in the `token` header, or `Authorization: DX <token>` or `Bearer <token>`. `GET /api` lists every route.

| Area | Routes |
|---|---|
| Console auth | `POST /auth/v1/login`, `POST /auth/v1/logout`, `GET /auth/v1/me`, `POST /auth/v1/password` |
| Identity | `GET/POST /identity/v1/orgs`, `POST /identity/v1/orgs/whitelist`, `GET/POST /identity/v1/csr`, `GET /identity/v1/csr/status`, `POST /identity/v1/csr/decide`, `GET /identity/v1/certs`, `POST /identity/v1/certs/revoke`, `GET /identity/v1/certs/status`, `GET /identity/v1/crl`, `GET /identity/v1/crl.pem`, `GET /identity/v1/trusted-cas`, `GET/POST /identity/v1/accounts`, `POST /identity/v1/accounts/unlock` |
| Catalogue | `GET /catalogue/v1/search` (q, attr/value, bbox, near, time/timerel, limit/offset), `GET /catalogue/v1/count`, `GET /catalogue/v1/list`, `GET/POST/PUT/DELETE /catalogue/v1/items`, `GET /catalogue/v1/datamodels`, `GET /catalogue/v1/policy-vocabulary`, `POST/DELETE /catalogue/v1/watch`, `GET /catalogue/v1/status` |
| Authorization | `POST /auth/v1/token`, `POST /auth/v1/token/introspect`, `POST /auth/v1/token/revoke`, `GET /auth/v1/token/list`, `GET/PUT /auth/v1/acl`, `GET /auth/v1/consent`, `POST /auth/v1/consent/decide`, `GET /auth/v1/flows`, `GET/POST/DELETE /auth/v1/licence`, `GET /auth/v1/status` |
| Resource | `GET /resource/v1/latest`, `/search`, `/status`, `/count`, `/download` (GeoJSON), `POST/PATCH/DELETE /resource/v1/subscription`, `GET /resource/v1/subscription/stream` (server-sent events), `POST /resource/v1/ingest`, `GET /resource/v1/servers` |
| Notify | `GET /notify/v1/inbox`, `GET /notify/v1/history` |
| City Intelligence | `GET /cil/v1/apis`, `GET /cil/v1/openapi`, `GET /cil/v1/ontology`, `POST /cil/v1/{domain}/{api}` (add `?format=ngsi-ld` for NGSI-LD), `POST/DELETE /cil/v1/analytics`, `GET /cil/v1/alerts`, `POST /cil/v1/olap`, `POST /cil/v1/ask`, `GET /cil/v1/report`, `POST /cil/v1/federate` |
| Status and operations | `GET /status/v1`, `GET /status/v1/heartbeat`, `GET /ops/v1/stats`, `GET /ops/v1/audit`, `GET /ops/v1/audit/verify`, `GET /ops/v1/audit/public-key`, `POST /ops/v1/backup`, `GET /ops/v1/backups`, `POST /ops/v1/service` |

Errors return `{ "error": "..." }` with a matching status. A 401 carries `WWW-Authenticate: DX realm=..., as_uri=...` pointing at the authorization server.

**Provider tasks with a class 3 certificate:** create, update or delete catalogue items of the provider's organisation (the owner is checked), push data with `POST /resource/v1/ingest` (each packet is checked against the item's data model), set policies with `PUT /auth/v1/acl`, and decide consent.

## 5. Data model

Catalogue items are JSON-LD documents with the context in `src/dx/model.js`. The item types are those of BIS Table 5 (resourceItem, resourceGroup, provider, resourceServer, catalogueItem). Mandatory fields follow Tables 6-8. Each item names a data model; data models list attributes with type and unit, and ingestion rejects packets that do not match.

The demo city has 48 catalogue items: 28 resource items, 12 groups, 5 providers, 2 resource servers and 1 catalogue item, covering the six City OS domains. One resource server (`rs2-adapter.wd.demo-city.example`) is a legacy server with CSV columns `LVL_M`, `FLOW_CUMECS`, `CAP_M`, `TS_UTC`; the DX Adapter translates it to the data model on the fly.

### Database tables

`meta, orgs, certs, csr_requests, accounts, sessions, items, readings, table_rows, tokens, consents, licences, watches, notices, subscriptions, audit, analytics, alerts, heartbeats, api_calls`.

## 6. City Intelligence Layer

- **19 domain APIs** (City OS section 4) across the six domains. Each has an OpenAPI description tagged with the ontology terms of City OS Figure 12, the inputs it reads, its period and its provenance.
- **Pluggable analytics.** A provider sends a declarative specification. The server checks the ontology terms and that every input attribute exists in the catalogue's data models (schema matching). Supported operations: meanByWard, maxByWard, minByWard, countAboveByWard. No uploaded code is run.
- **Scheduler and alerts.** Each API runs at its period. Alerts are de-duplicated for 60 seconds.
- **ICCC.** Alerts feed, OLAP by ward, day and category, keyword questions (not a language model), monthly report.
- **Federation.** `DX_FEDERATION_PEERS` lists other cities (`name=https://host:port`). A federated call runs the same API at each peer over mutual TLS and returns each answer and an aggregate.

## 7. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DX_DATA_DIR`, `DX_PKI_DIR`, `DX_BACKUP_DIR` | `./data`, `./pki`, `./backups` | Where state is kept |
| `DX_HOST`, `DX_PORT` | `0.0.0.0`, `8443` | Listen address |
| `DX_PUBLIC_NAME` | `dx.demo-city.example` | Server name in its certificate and ID-token audience |
| `DX_ALT_NAMES` | none | More DNS names for the server certificate (PKI setup only) |
| `DX_AUTH_HOST`, `DX_UAC_URL` | demo values | Token prefix and authorization server URL |
| `DX_CITY_NAME` | `Demo City` | Shown in the console |
| `DX_TOKEN_TTL`, `DX_SESSION_TTL` | 3600, 28800 | Seconds |
| `DX_RATE_LIMIT` | 600 | Requests per minute per client address |
| `DX_LOGIN_MAX_FAILURES` | 5 | Before a 15-minute lock |
| `DX_SCHEDULER`, `DX_SCHEDULER_MINUTE_MS` | true, 60000 | Analytics scheduler |
| `DX_HEARTBEAT_MS` | 60000 | Heartbeat interval |
| `DX_SIMULATOR`, `DX_SIMULATOR_MS` | true, 60000 | Synthetic sensor feed; turn off for real feeds |
| `DX_FEDERATION_PEERS`, `DX_FEDERATION_CA_FILE` | none | Other cities and their CA |
| `DX_OIDC_ISSUERS_FILE` | none | Extra trusted ID-token issuers |
| `DX_CIL_SERVICE_EMAIL` | `cil@mc.demo-city.example` | Certificate identity the CIL uses |
| `DX_REQUEST_CLIENT_CERT` | true | Ask clients for a certificate |
| `DX_LOG_REQUESTS` | false | Log each request to stdout |

## 8. Operations design

- **Audit log.** Every decision (identity, catalogue, authorization, resource, consent, CIL, operations) is one row. Each row stores the SHA-256 of the previous row and an Ed25519 signature made with `pki/audit/audit-ed25519.key`. `GET /ops/v1/audit/verify` re-checks the whole chain.
- **Status.** Each service writes a heartbeat every minute. `/status/v1` gives uptime, mean and 95th-percentile latency per service from recorded API calls.
- **Backups.** `VACUUM INTO` makes a consistent copy while the server runs, file mode 0600, then an integrity check. Restore also checks the audit chain before it replaces the database.
- **Hardening.** TLS 1.2 or later; strict Content-Security-Policy with no inline script or style; HSTS; no framing; 1 MB body limit; rate limit; SQL values always passed as parameters.

## 9. Mapping to the two documents

Every point of both documents is listed in `docs/requirements.json` (138 points). For each point the `server` field says whether the software implements it, how, and which tests check it. `docs/TEST_REPORT.md` is generated from a test run and lists the tests per point. The verification PDF uses the same file.

## 10. Known limits

- One process and one SQLite file. No clustering or high availability (BIS 5.5 scale-out is not covered).
- The demo CA is not a licensed certifying authority. Real use needs certificates under the Controller of Certifying Authorities (CCA) or the city's own approved CA.
- The question box matches keywords only.
- Sensor data is simulated. Live feeds need department agreements.
