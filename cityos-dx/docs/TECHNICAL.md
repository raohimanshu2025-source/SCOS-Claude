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
| `src/console-helpers.js` | Console shortcuts: add a department, a person or a dataset under the normal rules |
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
| `test/` | 85 end-to-end tests |

## 2. Identity and authentication

**Certificate authority (BIS 5.4.2, 7.1).** `npm run certs` makes a self-signed root CA, a DX CA signed by it, and a server certificate. The DX CA issues certificates with `openssl ca`, so it keeps a real `index.txt`, serial file and CRL. Each certificate carries a class policy OID (`2.25.228127155926915386208736734112418384017.<class>`) and the matching key usage.

| Kind | Classes | Rule |
|---|---|---|
| `rs` (resource server) | 1 | CN must be a DNS name under the organisation's domain |
| `org` | none (sent as `cls: 0`) | Organisation must be white-listed. BIS 5.4.2: the organisation certificate "can only be used to grant certificates to employees", so it cannot manage the catalogue or read data; it can only decide its own employees' requests |
| `officer` (data officer) | 3 | Organisation must hold a valid organisation certificate |
| `emp` (employee) | 2, 3, 4, 5 | Same |
| `ind` (individual / app developer) | 2 | No organisation needed |

The e-mail to the DX CA (BIS 5.4.2, 7.1) is modelled as `POST /identity/v1/csr`; every request must use the subject "Certificate request" (the standard states this subject for individuals and app developers; the server applies it to all requests). The e-mail domain must belong to a registered, white-listed organisation for organisation, employee, officer and resource server requests. The DX administrator decides any request; an organisation, acting as sub-CA / registration authority, may also decide requests of its own employees and data officers. Revocation adds the serial to the CRL, blocks the certificate at once and revokes its tokens.

**Licensed CAs (BIS 5.4.2).** "DX shall accept TLS connections using certificates from any licensed CA in India (certified by the CCA)." Put those CA certificates in the PEM file named by `DX_TRUSTED_CA_FILE` and their CRLs in `DX_TRUSTED_CRL_FILE`. A holder of such a certificate is identified by the e-mail in it and treated as class 2 (individual); certificates on the CRL are refused. Classes 3 to 5 need a certificate from the DX CA, because they need the organisation to be registered and white-listed.

**How a caller is identified**, in this order:

1. The TLS client certificate. A DX CA certificate must be in the database with status valid and not expired. A certificate from a configured licensed CA must chain to it and not be on its CRL.
2. An `X-ID-Token` header: an EdDSA JWT from a trusted OpenID Connect issuer (demo issuer `https://idp.demo-city.example`; more through `DX_OIDC_ISSUERS_FILE`). The audience must be the server's public name. BIS 4.4 lets consumers be identified this way, but 5.4.2 says protected, private or confidential data "shall require a valid certificate", so an ID token alone reaches public data only (class 0).
3. A console session cookie. The session belongs to an account that is linked to a certificate, so console actions run as that certificate holder.
4. Otherwise anonymous (public data and the status page only).

**Console accounts.** Passwords are hashed with scrypt, need at least 12 characters with letters and digits, and must be changed at first login. Five failures lock the account for 15 minutes. The cookie `dx_session` is HttpOnly, Secure and SameSite=Strict, and every write in a session needs the `X-CSRF-Token` header. Roles: admin, provider, consumer, operator, auditor, analytics_provider. Certificates without an account get the role of their kind: resource_server, organisation, provider (class 3) or consumer.

## 3. Authorization (BIS 4.5.2, 5.2-5.4, 7)

Each item has a policy P = (C, A): C is the list of consumers, A the Table 3 attributes. A new policy starts from its label's column of Table 4, copied cell by cell (for example a private item starts with data locality "Configurable or as per regulatory framework", data usage "Licensed with legal framework" and data audit "Needs audit"); the provider may then choose Table 3 values. Consent and data monetization from Table 4 are kept in A too. `GET /catalogue/v1/policy-vocabulary` returns Table 3, Table 4 and the label defaults. The label sets which certificate classes may read:

| Label | Classes |
|---|---|
| public | any, no token |
| protected | 2, 4, 5 |
| private | 4, 5 |
| confidential | 5 |

`POST /auth/v1/token` checks every requested item. If the caller is in C (or holds a licence from the provider) and has a suitable class, a token is issued. Otherwise the call returns 403 with the list of refused items, and a consent request goes to the provider's inbox.

Tokens have the form `auth.demo-city.example/<consumer e-mail>/<64 hex>` and last `DX_TOKEN_TTL` seconds (default 3600; BIS 3.1.11: every token "shall have a valid expiration time"). The response carries `token`, `token-type: IUDX` and `expires-in` as in Figure 2 step 5. Only the token's SHA-256 hash is stored. A token is bound to the certificate that asked for it: another certificate presenting it is refused. This is stricter than Figure 2, where step 6 needs only a server certificate.

A resource server checks a token with `POST /auth/v1/token/introspect` and body `{"token": ...}`. Only a class 1 `rs` certificate may do this. Figure 2 step 8 says "Verify resource-server's identity through DNS"; the server instead checks that the certificate's CN is the host in the item's resource server URL, and does no DNS lookup. The response has `consumer`, `consumer-certificate-class`, `expiry` and `request` (step 10) plus `policy`, the reference to the policy version (7.4). Results are cached briefly and every access is counted (BIS 5.6 flows).

A provider revokes a token with `POST /auth/v1/token/revoke` and body `{"token": ...}` (Figure 11), or all of one consumer's tokens for an item with `{"id", "consumer"}`. Catalogue entries are linked to the DN of the certificate that created them, and only that certificate may change them or their policy (BIS 5.3).

## 4. API reference

All paths are under the server root. Bodies are JSON. Tokens go in `Authorization: IUDX <token>` (Figure 2), or the `token` header, or `Authorization: DX <token>` or `Bearer <token>`. `GET /api` lists every route.

| Area | Routes |
|---|---|
| Console auth | `POST /auth/v1/login`, `POST /auth/v1/logout`, `GET /auth/v1/me`, `POST /auth/v1/password` |
| Identity | `GET/POST /identity/v1/orgs`, `POST /identity/v1/orgs/whitelist`, `GET/POST /identity/v1/csr`, `GET /identity/v1/csr/status`, `POST /identity/v1/csr/decide`, `GET /identity/v1/certs`, `POST /identity/v1/certs/revoke`, `GET /identity/v1/certs/status`, `GET /identity/v1/crl`, `GET /identity/v1/crl.pem`, `GET /identity/v1/trusted-cas`, `GET/POST /identity/v1/accounts`, `POST /identity/v1/accounts/unlock` |
| Catalogue | `GET /catalogue/v1/search` (q, attr/value, bbox, near, time/timerel, limit/offset), `GET /catalogue/v1/count`, `GET /catalogue/v1/list`, `GET/POST/PUT/DELETE /catalogue/v1/items` (POST answers 201 Created, Figure 7), `GET /catalogue/v1/datamodels`, `GET /catalogue/v1/schemas` (base schemas), `GET /catalogue/v1/context?name=core|common` (JSON-LD contexts; like data models these are not catalogue items, BIS 6.1.1), `GET /catalogue/v1/policy-vocabulary`, `POST/DELETE /catalogue/v1/watch`, `GET /catalogue/v1/status` |
| Authorization | `POST /auth/v1/token`, `POST /auth/v1/token/introspect`, `POST /auth/v1/token/revoke`, `GET /auth/v1/token/list`, `GET/POST/PUT/DELETE /auth/v1/acl` (DELETE resets to the label defaults; `POST /auth/1.0/acl` is also accepted, as printed in Figure 8), `GET /auth/v1/consumers`, `GET /auth/v1/consent`, `POST /auth/v1/consent/decide`, `GET /auth/v1/flows`, `GET/POST/DELETE /auth/v1/licence`, `GET /auth/v1/status` |
| Resource | `GET /resource/v1/latest`, `/search`, `/status`, `/count`, `/download` (GeoJSON), `POST/PATCH/DELETE /resource/v1/subscription`, `GET /resource/v1/subscription/stream` (server-sent events), `POST /resource/v1/ingest`, `GET /resource/v1/servers` |
| Notify | `GET /notify/v1/inbox`, `GET /notify/v1/history` |
| City Intelligence | `GET /cil/v1/apis`, `GET /cil/v1/openapi`, `GET /cil/v1/ontology`, `POST /cil/v1/{domain}/{api}` (add `?format=ngsi-ld` for NGSI-LD), `POST/DELETE /cil/v1/analytics`, `GET /cil/v1/alerts`, `POST /cil/v1/olap`, `POST /cil/v1/ask`, `GET /cil/v1/report`, `POST /cil/v1/federate` |
| Status and operations | `GET /status/v1`, `GET /status/v1/heartbeat`, `GET /ops/v1/stats`, `GET /ops/v1/audit`, `GET /ops/v1/audit/verify`, `GET /ops/v1/audit/public-key`, `POST /ops/v1/backup`, `GET /ops/v1/backups`, `POST /ops/v1/service` |

Errors return `{ "error": "..." }` with a matching status. A 401 carries `WWW-Authenticate: DX realm=..., as_uri=...` pointing at the authorization server.

**Provider tasks with a class 3 certificate:** create, update or delete the catalogue items that certificate created (the owner DN is checked), push data with `POST /resource/v1/ingest` (each packet is checked against the item's data model), set policies with `PUT /auth/v1/acl`, and decide consent.

## 5. Data model

Catalogue items are JSON-LD documents with the context in `src/dx/model.js`. The item types are those of BIS Table 5 (resourceItem, resourceServerGroup, provider, resourceServer, catalogueItem; Table 7 names the provider row "providerItem" and has no row for catalogueItem, so its mandatory list here is our own). Mandatory fields follow Tables 6-8. Each item names a data model; data models list attributes with type and unit, and ingestion rejects packets that do not match.

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
| `DX_TRUSTED_CA_FILE`, `DX_TRUSTED_CRL_FILE` | none | CA certificates and CRLs of licensed CAs whose certificates are accepted (BIS 5.4.2) |
| `DX_CIL_SERVICE_EMAIL` | `cil@mc.demo-city.example` | Certificate identity the CIL uses |
| `DX_REQUEST_CLIENT_CERT` | true | Ask clients for a certificate |
| `DX_LOG_REQUESTS` | false | Log each request to stdout |

## 8. Operations design

- **Audit log.** Every event (identity, discover, manage, authorization, resource, consent, CIL, operations) is one row (BIS 5.5). Each row stores the SHA-256 of the previous row and an Ed25519 signature made with `pki/audit/audit-ed25519.key`. `GET /ops/v1/audit/verify` re-checks the whole chain.
- **Status.** Each service writes a heartbeat every minute. `/status/v1` gives uptime, mean and 95th-percentile latency per service and per endpoint from recorded API calls, and the state of each resource server (BIS 5.6).
- **Backups.** `VACUUM INTO` makes a consistent copy while the server runs, file mode 0600, then an integrity check. Restore also checks the audit chain before it replaces the database.
- **Hardening.** TLS 1.2 or later; strict Content-Security-Policy with no inline script or style; HSTS; no framing; 1 MB body limit; rate limit; SQL values always passed as parameters.

## 9. Mapping to the two documents

Every point of both documents is listed in `docs/requirements.json` (138 points). For each point the `server` field says whether the software implements it, how, and which tests check it. `docs/TEST_REPORT.md` is generated from a test run and lists the tests per point. The verification PDF uses the same file.

## 10. Known limits

- One process and one SQLite file. No clustering or high availability (the BIS 5.6 "distributed architecture for vertical and horizontal scale" is not covered).
- The demo CA is not a licensed certifying authority. Licensed CAs can be configured (section 2), but none are configured in the demo.
- Trusted execution environments for policy enforcement at the time of data use (BIS 4.5.2.1, "shall support") are not implemented.
- Streams use server-sent events; MQTT and AMQP with AsyncAPI are not implemented.
- The question box matches keywords only.
- Sensor data is simulated. Live feeds need department agreements.
