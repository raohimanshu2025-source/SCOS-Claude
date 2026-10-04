# Conformance to the two documents

This is the result of a line-by-line check of the software and the point list against:

- **BIS**: draft IS 18XXXX-X (Part 1):2019, *Data Exchange Reference Architecture* v0.9. All 60 pages were read, including the figures.
- **COS**: *City Operating System and City Intelligence Layer* v1.1, 27 July 2023. All 13 pages were read, including the figures.

It was done on 29-30 September 2026. The check led to fixes in the server, 24 new points, corrected wording for 29 points and honest statuses. The status of every point is in [requirements.json](requirements.json), field `server`, and in the server verification PDF.

## Result

| | BIS | COS | Total |
|---|---|---|---|
| Points | 125 | 37 | 162 |
| Working and tested | 104 | 25 | 129 |
| Partly met | 11 | 9 | 20 |
| Not met | 2 | 0 | 2 |
| Statement, no function | 5 | 3 | 8 |
| Out of scope in the document | 3 | 0 | 3 |

**Not met:** trusted execution environments for policy enforcement (BIS-111) and operations on resource groups (BIS-124).

**Partly met:** BIS-37, 55, 60, 78, 92, 102, 109, 113, 114, 118, 125 and COS-08, 12, 15, 16, 23, 31, 33, 34, 37. Each row in the PDF says what is missing.

So the software does **not** follow the two documents 100%. It follows the 129 tested points, and it says plainly where it falls short.

## What the check found and fixed

| Finding | Document wording | Fix |
|---|---|---|
| The organisation certificate could manage the catalogue and read data | "can only be used to grant certificates to employees of the organization" (BIS 5.4.2, p. 26) | The organisation certificate has no class. It can only decide its own employees' certificate requests, as sub-CA or registration authority |
| Employees could not get class 3 | "Class 3: Which can be issued to employees and data-officers" (p. 27) | Employees can get class 2, 3, 4 or 5 |
| A citizen with only an ID token could read protected data | "who wish to access protected private, or confidential data shall require a valid certificate" (p. 26) | An ID token alone reaches public data only |
| Certificates from licensed CAs were refused | "DX shall accept TLS connections using certificates from any licensed CA in India" (p. 26) | Licensed CAs and their CRLs can be configured; their certificates are accepted as class 2 |
| Any class 3 holder of the organisation could edit another's entry | "The entries in the catalog are linked to the DN of a user's certificate. Thus, only the original owner shall be able to modify" (p. 23) | Ownership is by certificate DN |
| Label defaults were our own choice of Table 3 values | Table 4 (p. 24-25) | Table 4 is stored cell by cell and used as the defaults |
| `Authorization: IUDX <token>` was refused; token-type was "DX" | Figure 2 steps 5 and 6 (p. 21) | Both now as printed |
| The provider could not revoke with `{"token": ...}` | Figure 11 (p. 51) | Now possible |
| Tokens did not carry the policy reference | 7.4: "Include a reference to the policy object in access tokens" | Introspection returns the policy version |
| Catalogue create answered 200 | Figure 7: "201 Created" (p. 47) | Now 201 |
| No create, delete or consumer list for access policies | Table 2 Manage (p. 16) | POST and DELETE /auth/v1/acl, POST /auth/1.0/acl (Figure 8), GET /auth/v1/consumers |
| Search and view were not in the audit log | "All Interfaces shall ... log all events" (5.5, p. 27) | Discover events are logged |
| Status page was per service only | "reports the same for each of the endpoints" (5.6, p. 27) | Per endpoint and per resource server too |
| Employee details were dropped from certificates | "may add more details about the employee" (p. 26) | Organisation, unit, names, role, state and city are kept |
| Numeric strings and arrays were not accepted as quantities | 6.2.4 and footnote 6 (p. 33) | Accepted; other strings refused |
| No base schemas or contexts were served | 6.1.1 (p. 31) | Served by the catalogue, not as items |

Point wording was corrected where our summary was stronger than the document. For example, BIS-08 said "only on explicit Consent", BIS-69 said a policy "is associated" where the document says DX "shall enable", COS-08 said "each city has a COS" where the document says "possibly", and COS-09 said "connect directly" where the document says "can be directly interfaced".

## Still different from the wording

These are deliberate. Each is stated in the verification PDF.

- **Certificate requests.** They arrive through the API instead of by e-mail (BIS 5.4.2, 7.1). The "Certificate request" subject is required on every request, not only from individuals and app developers.
- **Tokens.** A token only works with the certificate that asked for it. Figure 2 step 6 needs only a server certificate, so this is stricter.
- **Figure 2 step 8.** The resource server is identified by its certificate name, not through DNS.
- **Policies.** They are held as P = (C, A) in JSON, not as XACML or Aperture text. The Table 3 attributes have short API names (for example `authProtocol` for "Authorization protocol and policy"), and the printed names are published beside them.
- **Names.** Resource types are spelled `messageStream` and `mediaStream`, where Table 8 prints "message Stream" and "media stream". Table 7 has no row for catalogueItem, so its mandatory list is ours.
- **Streams.** They use server-sent events, not MQTT or AMQP.
- **Federation.** It calls the other city's CIL API. COS Figure 2 puts the data exchange layer in between.
- **Air quality API.** The spatialForecast API averages a past time window and makes no forecast.
- **CIL API paths.** COS names only two: `/environment/spatialForecast` and `/publictransit/eta`. The other 17 paths are our own names. The two waste "anomaly" analytics are one API.
- **Ontology.** It adds the egress type "Single Stat", which comes from COS Figure 10 but is not in Figure 12.

## Added by us (not asked for by the documents)

**Choices the documents leave open:**
- Node.js, SQLite and the OpenSSL tool.
- TLS 1.2 or later (BIS cites TLS 1.2).
- A DX-hosted CA with our own class markers, since BIS allows DX to host a CA.
- A hash-chained, signed audit log. BIS asks for a non-repudiable trail but not how.
- A notification inbox for consent. BIS leaves coordination open.
- Licence records.
- NGSI-LD output, since BIS compares its model to NGSI-LD.
- A demo ID-token issuer.
- The Apache 2.0 licence. COS asks for open source.

**Beyond the documents:**
- Officer password logins with six roles, sessions, CSRF protection and lockout.
- A rate limit and browser security headers.
- Backups, restore and an uptime probe.
- Docker, systemd and GitHub Actions.
- Service drills.
- Plugged analytics limited to four declarative operations, with no uploaded code.
- The 60-second de-duplication of alerts.
- The web console.
- The public portal on the home page: tiles, a map and dashboards drawn only from public items, public analytics and the status page, without a login, in English and Hindi. Its look is our choice; it uses no government emblem or logo and says on every page that it is not an official website.
- Console shortcuts for adding a department, a person, a dataset group, a dataset and its data. They use the same rules and audit log as the API. For a person, the DX-hosted CA creates the key pair instead of receiving a request, so this is a demo convenience, not the BIS 7.1 request process.
- The ISO/IEC 27001 self-assessment.
- Advice on the DPDP Act and CERT-In.
- The synthetic "Demo City" data and its simulator.
- The Kanpur profile (`DX_CITY_PROFILE=kanpur`, file `src/seed-kanpur.js`). It uses the names of 11 Kanpur departments (Nagar Nigam, Jal Sansthan, KESCO, Traffic Police, Fire Service, CMO health, KDA, PWD, UPPCB, City Transport, ICCC control room), each marked "(demo)". Its zones, place points and all readings are synthetic. No department has given or approved any data.
- The past incidents page and its dataset (`urn:demo-cat:incidents/past-incidents-news`, data model `pastIncident`, file `src/data/kanpur-incidents-build.json`). Unlike everything else here, these are 52 real Kanpur incidents (2021-2026) summarised from public news reports, each with its source link. They were read by an automated tool and not checked by hand, and the page says so. Officials' names are removed from the department field. Map points are the approximate centre of the locality named in the news. The documents do not ask for this.
- Ten data models for that profile: power feeder, pump station, water supply, traffic junction, fire call, hospital beds, building permit, road work, power cut notice and past incident. The documents do not define these. They follow the same data model rules (BIS Section 6) as the other models.
- The Kanpur welcome on the portal: a "Namaste Kanpur" greeting, a sky that follows the time of day in Kanpur, a skyline of simple drawings of known places (IIT Kanpur, Green Park, Ghantaghar, JK Temple, Ganga Barrage) and four citizen buttons (water supply, power cuts, hospital beds, report a problem). The buttons only read public items. The weather line is the demo sensor data. "Report a problem" is a demo form: it sends and saves nothing, and says so. The documents do not ask for any of this.
- The site-wide sky theme (`public/sky-theme.js`, `public/sky.css`): night in Kanpur gives the portal and the officer console a night look, a sunny day adds a soft glow, and rain reported by the public demo weather stations shows gentle falling rain. High contrast turns the effects off and "reduce motion" stops the rain. This is a look only; the documents do not ask for it.

None of these changes what the documents require. They are there for security, operation and demonstration.

## Inconsistencies inside the documents

These are worth knowing when checking.

**BIS:**
- 4.4 puts certificate provisioning out of scope, but 5.4.2 specifies a DX CA.
- 4.5.2.2 says policies define the attributes a consumer can access, but 5.3 says attribute-level policy is not supported.
- Figure 5 lets the consumer get consent history, but 5.3 makes it private to the provider.
- Some names do not match across sections:
  - coverageArea (text) and coverageRegion (Table 6).
  - accessVariables (annex) and accessObjectVariables (Table 6).
  - providerItem (Table 7) and provider (Table 5).
  - /auth/1.0/acl (Figure 8) and /auth/v1/ elsewhere.
- Figure 3 is empty in the PDF.
- The contents page lists different page numbers from the printed pages.

**COS:** Figure 12 has typing errors ("CategoricalVisualiztion", "Addidional").
