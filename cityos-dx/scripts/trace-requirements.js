// Writes the "server" field of each point in docs/requirements.json from the latest test run
// (test-output/summary.json) plus the notes below. The demo fields (status, how) are left as they are.
// Run after `npm run test:report`.
import fs from 'node:fs';

const REQ = new URL('../docs/requirements.json', import.meta.url);
const reqs = JSON.parse(fs.readFileSync(REQ, 'utf8'));
const run = JSON.parse(fs.readFileSync(new URL('../test-output/summary.json', import.meta.url), 'utf8'));

// Points that need words beyond "tested". status: working | partial | notmet | explained | outscope
// [status, how, [ids whose tests also count]]. Revised on 30 Sep 2026 after the audit against the documents' wording.
const NOTES = {
  'BIS-04': ['working', 'Security by design is the sum of the tested points: mutual TLS, X.509 classes, policies, consent, sender-bound tokens and the signed audit log. See docs/SECURITY_CONTROLS.md.', ['BIS-59', 'BIS-65', 'BIS-11']],
  'BIS-07': ['explained', 'The roles are real principals in the server (provider organisations, resource servers, consumers, apps) and are named the same way in the API and console.'],
  'BIS-09': ['working', 'Every interface is HTTPS with JSON bodies. The tests call it with plain Node.js HTTPS and the README shows curl, so any language can use it.', ['BIS-102']],
  'BIS-25': ['explained', 'App developers hold class 2 certificates and licence agreements; the DX provider runs this server.'],
  'BIS-31': ['working', 'Licence agreements with terms are recorded by the provider and let the app in without separate consent. Coordination by SMS or e-mail is modelled by the notification inbox.', ['BIS-32']],
  'BIS-37': ['partial', 'GIS files download as GeoJSON (tested). A camera is catalogued as a mediaStream with its stream address, but no video is hosted or played.'],
  'BIS-38': ['outscope', 'Out of scope in the standard. The server still accepts ID tokens from configured external OpenID Connect issuers.'],
  'BIS-39': ['outscope', 'Out of scope in the standard. The server offers consent requests through the authorization service and the provider inbox.'],
  'BIS-40': ['explained', 'Runs as one process, in Docker or under systemd; nothing ties it to one deployment model.'],
  'BIS-41': ['working', 'Certificates identify providers, apps and consumers. ID tokens from trusted OpenID Connect issuers identify consumers, but only for public data, because 5.4.2 requires a certificate for anything else (BIS-110). SAML 2.0 is not implemented.'],
  'BIS-50': ['outscope', 'Out of scope in the standard, and not done by the server. Trusted execution environments: see BIS-111.'],
  'BIS-54': ['working', 'CA certificates of licensed CAs (and their CRLs) are configured with DX_TRUSTED_CA_FILE and DX_TRUSTED_CRL_FILE; their certificates are accepted over TLS as class 2 identities, revoked ones are refused (tested with a stand-in CA). No real CCA-licensed CA is configured in the demo.'],
  'BIS-55': ['partial', 'The resource servers validate tokens of the DX authorization server by introspection and answer 401 with the authorization server address when no token is sent (tested). Tokens of a provider\'s own authorization server are not supported.'],
  'BIS-58': ['working', 'All thirteen steps run, with the paths, headers and fields of Figure 2 (tested). Step 8 is done by matching the certificate name, not by DNS: see BIS-113.'],
  'BIS-60': ['partial', 'Self-assessment against ISO/IEC 27001:2022 Annex A in docs/SECURITY_CONTROLS.md. Not certified; organisational controls and an audit are for the city.'],
  'BIS-64': ['explained', 'Vetting policies is the provider\'s duty in the standard. The provider console shows each policy and every token flow for review.'],
  'BIS-67': ['working', 'Only a class 3 certificate can create, update or delete entries, and only the certificate whose DN created an entry can change it (tested with a second class 3 employee of the same organisation).', ['BIS-104']],
  'BIS-72': ['working', 'Table 4 is stored cell by cell and published by /catalogue/v1/policy-vocabulary; a new policy starts from its label\'s column word for word (tested).'],
  'BIS-75': ['working', 'Requests are made through the API, standing in for the e-mail to the DX CA; the subject line, white-list and domain rules are checked (tested). The server asks for the "Certificate request" subject on every request, not only from individuals and app developers.'],
  'BIS-76': ['working', 'Classes follow the standard: 1 resource servers, 2 individuals and employees, 3 employees and data officers, 4 and 5 trusted employees (tested). The organisation certificate has no class (BIS-104).', ['BIS-104']],
  'BIS-78': ['partial', 'Backups, restore, health checks and automatic restart work and are tested. There is no distributed high availability or scaling: one process, one database.'],
  'BIS-92': ['partial', 'Items carry OpenAPI access information that refers to the data model (tested). Streams are served as server-sent events; MQTT or AMQP with AsyncAPI is not implemented.'],
  'BIS-97': ['working', 'A class 3 provider creates and manages entries and sets policies (tested). The "request the authorization service for permission" step is the class 3 certificate check itself; there is no separate permission request.'],
  'BIS-99': ['working', 'Tokens reference the policy version and introspection returns it (tested). Claims are pushed through certificates; there is no interactive claims gathering, as the standard says. Policies use the server\'s own form P = (C, A), not XACML or Aperture text.'],
  'BIS-102': ['partial', 'TLS 1.2+, HTTP/1.1, JSON, GeoJSON and ISO 8601 are used and tested. MQTT and AMQP are not implemented.'],
  'BIS-103': ['working', 'Every token carries expires-in and an expiry; expired tokens are refused at introspection (tested).', ['BIS-58']],
  'BIS-105': ['working', 'Requests for organisations, employees, officers and resource servers of an organisation not on the white-list are refused (tested).', ['BIS-75']],
  'BIS-106': ['working', 'The organisation certificate can list and decide its own employees\' and officers\' requests, and nothing else (tested); the DX administrator can also decide.', ['BIS-104']],
  'BIS-108': ['working', 'Individuals get class 2 certificates for their e-mail address, with no organisation needed (tested).', ['BIS-75']],
  'BIS-109': ['partial', 'Organisations decide their employees\' requests through the API (POST /identity/v1/csr/decide); no separate script is shipped to organisations.'],
  'BIS-110': ['working', 'Protected, private and confidential items need a certificate of the right class; an ID token alone reaches public data only (tested).', ['BIS-41']],
  'BIS-111': ['notmet', 'Not implemented. The server has no trusted execution environment support.'],
  'BIS-112': ['working', 'Response fields token, token-type IUDX and expires-in; header Authorization: IUDX <token>; introspection path and body; step 10 fields consumer, consumer-certificate-class, expiry, request; mutual TLS on the token, introspection and data calls (tested). Tokens are also bound to the consumer\'s certificate, which is stricter than the figure.', ['BIS-58']],
  'BIS-113': ['partial', 'The resource server is identified by its class 1 certificate, whose CN must be the host in the catalogue entry of the resource server. No DNS lookup is made.'],
  'BIS-114': ['partial', 'The demo items use the Table 6 attributes with their core types, and location and coverageRegion formats are checked (tested). The value format of every other Table 6 row is not checked.'],
  'BIS-115': ['working', 'All four Table 7 rows are enforced when an item is created; every test run creates the whole demo catalogue through these checks. (Table 7 calls the provider row providerItem; Table 5 and the server say provider.)', ['BIS-89']],
  'BIS-116': ['working', 'POST /catalogue/v1/items with a class 3 certificate is validated and answers 201 Created (tested).', ['BIS-67']],
  'BIS-117': ['explained', 'A duty of the provider and the operator. docs/OPERATIONS.md lists a data protection review under the Digital Personal Data Protection Act, 2023 before real use.'],
  'BIS-118': ['partial', 'Consent requests go to the provider, who approves or rejects them (tested), but the consent artefact architecture of reference [b.2] is not implemented.', ['BIS-14']],
  'BIS-119': ['working', 'Steps 3 and 4 run through the API, including POST /auth/1.0/acl exactly as printed (tested). Steps 1 and 2 are internal to the resource server, as the figure marks them.'],
  'BIS-120': ['working', 'Base schemas (/catalogue/v1/schemas) and data models (/catalogue/v1/datamodels) are served by the catalogue and are not catalogue items (tested).'],
  'BIS-121': ['working', 'The core and common JSON-LD contexts are served at /catalogue/v1/context (tested).'],
  'BIS-122': ['working', 'Every attribute of every data model has one of the five core types, and items are checked against them (tested).', ['BIS-90']],
  'BIS-123': ['working', 'Numbers, numeric strings and arrays of them are accepted; "12 kg" is refused (tested).', ['BIS-87']],
  'BIS-124': ['notmet', 'Not implemented. Data and status are read per resource item, not per group.'],
  'BIS-125': ['partial', 'Approving consent adds the consumer to the policy, and every token is logged (tested); the token itself is not what updates the policy.', ['BIS-14']],
  'COS-08': ['partial', 'City-to-city federation over mutual TLS works and is tested with two cities; state-level and national-level tiers and central access policies are not implemented, and federation calls the other city\'s CIL API rather than going through its data exchange layer.'],
  'COS-10': ['explained', 'A claim about the ICCC procurement lifecycle; nothing for software to do.'],
  'COS-11': ['explained', 'A claim about how officials spend time; nothing for software to do.'],
  'COS-12': ['partial', 'Developers can combine the CIL APIs through OpenAPI (tested). Of the transit example only the bus ETA API exists: see COS-37.'],
  'COS-15': ['partial', 'Bus regularity (on-time percent) is aggregated across two cities (tested). No bus versus metro financial comparison exists.'],
  'COS-16': ['partial', 'Interpolation to a grid and alerts above 90 µg/m³ work (tested). The time window is averaged, so no forecast values are produced, and hotspots are shown as grid cells above the alert level rather than a separate result.'],
  'COS-20': ['working', 'Interpolation, wind and heat-island APIs run on station data (tested). The forecast is a simple trend, not a weather model.'],
  'COS-22': ['working', 'Each API has an OpenAPI description with its ontology terms (tested). Responses also carry bookkeeping fields (api, city, computedAt).'],
  'COS-23': ['partial', 'The path and request fields match Figure 9 and the output is a MeshGrid heat map (tested). forecastStart and forecastEnd select a past window that is averaged; no forecast is made.'],
  'COS-29': ['working', 'Questions are answered by calling CIL APIs (tested). Matching is by keywords, not a language model.'],
  'COS-31': ['partial', 'OLAP, analytic executor, rules and alerts, scheduler, questions, pluggable analytics, CIL APIs, reports and NGSI-LD output exist (tested). File, object-store and data-warehouse sources are not.'],
  'COS-33': ['partial', 'Specifications with input schema, procedure, output schema, provenance and visualisation are checked by schema matching and run (tested). There is no behaviour specification and no separate domain-specific versus generic repository.'],
  'COS-34': ['partial', 'A federated aggregate of one KPI across cities works (tested); state-level and sector-wise reports are not produced.'],
  'COS-35': ['working', 'Built only from open source parts (Node.js, OpenSSL, SQLite) under the Apache 2.0 licence and published at github.com/raohimanshu2025-source/SCOS-Claude.'],
  'COS-36': ['explained', 'A claim about development cost; the software does not measure it.'],
  'COS-37': ['partial', 'Only the bus ETA API exists, and it does not use weather or event conditions. Walking, autorickshaw, bicycle, car, metro and suburban rail predictions and occupancy predictions are not implemented.'],
};

let counts = {};
for (const p of reqs) {
  const tests = run.byReq[p.id] || [];
  const [status, how, borrow] = NOTES[p.id] || [tests.length ? 'working' : 'untested', tests.length ? 'Checked by the automated tests listed.' : ''];
  const extra = (borrow || []).flatMap(id => run.byReq[id] || []);
  p.server = { status, how, tests: [...new Set([...tests, ...extra])] };
  counts[status] = (counts[status] || 0) + 1;
}
fs.writeFileSync(REQ, JSON.stringify(reqs, null, 1) + '\n');
console.log(JSON.stringify({ run: run.date, tests: `${run.pass}/${run.tests}`, points: reqs.length, counts }));
if (counts.untested) { console.error('untested:', reqs.filter(p => p.server.status === 'untested').map(p => p.id).join(' ')); process.exit(1); }
