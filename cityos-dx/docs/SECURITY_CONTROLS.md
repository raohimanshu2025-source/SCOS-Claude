# Security controls: self-assessment

> **This is not a certification.** ISO/IEC 27001 certifies an organisation's information security management system, not a piece of software. Only an accredited certification body can certify the city (or its operator) after an audit. This page is the software team's own statement of which Annex A controls of ISO/IEC 27001:2022 the software supports, and which ones remain for the organisation that runs it. It supports BIS 5.5 (security) and responds to BIS point BIS-60.

Status values: **In software** (the code does it, with a test where one is named), **Supported** (the software helps, the operator must also act), **Operator** (outside the software).

## Technological controls (Annex A.8) and related identity controls (A.5)

| Control | Status | How | Test evidence |
|---|---|---|---|
| 5.15 Access control | In software | Policies P = (C, A) per item; label to certificate class rules; role checks on every console action | `10-authorization.test.js` |
| 5.16 Identity management | Supported | Organisations, white-list, certificate requests with approval; accounts per person | `01-identity.test.js`, `02-accounts.test.js` |
| 5.17 Authentication information | In software | scrypt password hashes; 12-character minimum; change at first login; tokens stored only as SHA-256 | `02-accounts.test.js` |
| 5.18 Access rights | In software | Consent and licence decisions by the provider; revocation of consumers, tokens and certificates takes effect at once | `10-authorization.test.js`, `01-identity.test.js` |
| 8.2 Privileged access rights | In software | Admin-only routes for certificates, accounts, backups and drills; auditor is read-only | `02-accounts.test.js` |
| 8.3 Information access restriction | In software | Class checks, sender-constrained tokens, views without personal data | `04-resource.test.js`, `10-authorization.test.js` |
| 8.5 Secure authentication | In software | Mutual TLS with X.509 certificates; signed ID tokens; lockout after 5 failures; HttpOnly, Secure, SameSite=Strict cookie and CSRF header | `01-identity.test.js`, `02-accounts.test.js` |
| 8.6 Capacity management | Supported | Rate limit per client; latency and uptime per service on the status page | `06-operations.test.js` |
| 8.7 Protection against malware | Operator | Host antivirus and patching. The software has no npm dependencies and runs no uploaded code | none |
| 8.8 Management of technical vulnerabilities | Operator | Patch Node.js, OpenSSL and the OS; run a vulnerability assessment | none |
| 8.9 Configuration management | Supported | All settings in environment variables; systemd unit with hardening options; Docker image | `deploy/` |
| 8.10 Information deletion | Supported | Catalogue delete; session purge; backup pruning. A retention policy must be set by the city | `03-catalogue.test.js` |
| 8.11 Data masking | In software | Views that drop personal fields; grievance data served as counts | `04-resource.test.js` |
| 8.12 Data leakage prevention | In software | Every read is authorized per item; errors do not return data; strict response headers | `04-resource.test.js`, `10-authorization.test.js` |
| 8.13 Information backup | In software | Online backups with integrity check; restore checks the audit chain; daily schedule in `deploy/` | `06-operations.test.js` |
| 8.14 Redundancy | Operator | Single process. A second site or hot standby is needed for high availability | none |
| 8.15 Logging | In software | Every decision written to the audit log with actor, interface, action and result | `06-operations.test.js`, `07-scenarios.test.js` |
| 8.16 Monitoring activities | In software | Heartbeats, status page, per-interface statistics, external uptime probe | `06-operations.test.js` |
| 8.17 Clock synchronisation | Operator | Run NTP on the host (audit times and token expiry depend on it) | none |
| 8.20 Networks security | In software | TLS 1.2 or later only; untrusted client certificates refused | `01-identity.test.js` |
| 8.21 Security of network services | Operator | Firewall, reverse proxy or gateway, DDoS protection | none |
| 8.22 Segregation of networks | Operator | Put the server and resource servers on a separate network zone | none |
| 8.24 Use of cryptography | In software | X.509 PKI with CRL; Ed25519 audit signatures; SHA-256; scrypt | `01-identity.test.js`, `06-operations.test.js` |
| 8.25 Secure development life cycle | Supported | Tests run on every change; test report with coverage | `docs/TEST_REPORT.md` |
| 8.26 Application security requirements | In software | Input checked against data models and item schemas; 1 MB body limit; SQL values passed as parameters | `03-catalogue.test.js`, `04-resource.test.js` |
| 8.28 Secure coding | In software | No dependencies; no eval or uploaded code; strict Content-Security-Policy with no inline script | `06-operations.test.js`, `07-scenarios.test.js` |
| 8.29 Security testing | In software | 84 end-to-end tests over HTTPS, including refusals and tampering | `docs/TEST_REPORT.md` |
| 8.32 Change management | Operator | Change approval process of the city | none |
| 8.34 Protection during audit testing | Operator | Plan audits on a copy or in a window | none |

## Organisational, people and physical controls

All of Annex A.5 (other than the controls above), A.6 (people) and A.7 (physical) are **Operator** controls. Examples the city must provide: an information security policy and owner, staff screening and training, incident management and reporting to CERT-In within the required time, supplier agreements with departments, physical security of the data centre, and business continuity plans.

## Still needed before real use

1. An independent security audit (for example by a CERT-In empanelled auditor) with a vulnerability assessment and penetration test.
2. Certificates from a licensed certifying authority, or the city's approved CA, with keys in a hardware security module.
3. A data protection review under the Digital Personal Data Protection Act, 2023.
4. The operator controls in this page, owned by the city.

See also [OPERATIONS.md](OPERATIONS.md#before-real-use).
