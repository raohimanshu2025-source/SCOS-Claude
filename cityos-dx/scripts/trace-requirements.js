// Writes the "server" field of each point in docs/requirements.json from the latest test run
// (test-output/summary.json) plus the notes below. The demo fields (status, how) are left as they are.
// Run after `npm run test:report`.
import fs from 'node:fs';

const REQ = new URL('../docs/requirements.json', import.meta.url);
const reqs = JSON.parse(fs.readFileSync(REQ, 'utf8'));
const run = JSON.parse(fs.readFileSync(new URL('../test-output/summary.json', import.meta.url), 'utf8'));

// Points that need words beyond "tested". status: working | partial | explained | outscope
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
  'BIS-50': ['outscope', 'Out of scope in the standard, and not done by the server.'],
  'BIS-60': ['partial', 'Self-assessment against ISO/IEC 27001:2022 Annex A in docs/SECURITY_CONTROLS.md. Not certified; organisational controls and an audit are for the city.'],
  'BIS-64': ['explained', 'Vetting policies is the provider\'s duty in the standard. The provider console shows each policy and every token flow for review.'],
  'BIS-78': ['partial', 'Backups, restore, health checks and automatic restart work and are tested. There is no distributed high availability or scaling: one process, one database.'],
  'BIS-92': ['partial', 'Items carry OpenAPI access information that refers to the data model (tested). Streams are served as server-sent events; MQTT or AMQP with AsyncAPI is not implemented.'],
  'BIS-102': ['partial', 'TLS 1.2+, HTTP/1.1, JSON, GeoJSON and ISO 8601 are used and tested. MQTT and AMQP are not implemented.'],
  'COS-10': ['explained', 'A claim about the ICCC procurement lifecycle; nothing for software to do.'],
  'COS-11': ['explained', 'A claim about how officials spend time; nothing for software to do.'],
  'COS-20': ['working', 'Interpolation, wind and heat-island APIs run on station data (tested). The forecast is a simple trend, not a weather model.'],
  'COS-29': ['working', 'Questions are answered by calling CIL APIs (tested). Matching is by keywords, not a language model.'],
  'COS-35': ['partial', 'Built only from open source parts (Node.js, OpenSSL, SQLite) under the Apache 2.0 licence. Publishing to a public Git repository is still to be done.'],
  'COS-36': ['explained', 'A claim about development cost; the software does not measure it.'],
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
if (counts.untested) process.exit(1);
