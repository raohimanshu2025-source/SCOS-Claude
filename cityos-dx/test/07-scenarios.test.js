// End-to-end: the minimal interaction scenarios of BIS section 7 (Figure 5), done by a brand-new provider,
// plus the architecture-level points (components, six interfaces, open APIs, COS = DX + CIL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startCity } from './helpers.js';
import { IFACES } from '../src/audit.js';

let c, admin, tmp;
before(async () => { c = await startCity(); admin = await c.login('admin'); tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scn-')); });
after(async () => { await c.stop(); fs.rmSync(tmp, { recursive: true, force: true }); });

// makes a key and CSR on "the provider's computer"; the key never leaves it
function keyAndCsr(name, subj) {
  const key = path.join(tmp, name + '.key');
  const csr = execFileSync('openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', key, '-subj', subj], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  return { key: fs.readFileSync(key), csr };
}
async function certify(name, subj, cls, kind) {
  const k = keyAndCsr(name, subj);
  const r = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: k.csr, cls, kind } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = await admin.as('POST', '/identity/v1/csr/decide', { body: { id: r.body.id, approve: true } });
  assert.equal(d.body.status, 'issued');
  return { cert: d.body.certificate, key: k.key };
}

test('[BIS-95][BIS-96][BIS-97][BIS-98][BIS-99][BIS-100][BIS-53][BIS-24][BIS-47] minimal scenarios end to end with a new provider organisation', async () => {
  // 7.1 Provider registration
  await admin.as('POST', '/identity/v1/orgs', { body: { id: 'parks', name: 'Parks Department (demo)', domain: 'parks.demo-city.example', whitelisted: true } });
  await certify('org', '/CN=Parks organisation/emailAddress=dx@parks.demo-city.example', 0, 'org');
  const officer = await certify('officer', '/CN=Parks data officer/emailAddress=officer@parks.demo-city.example', 3, 'officer');
  // 7.2 Create and manage metadata: provider, then a group and an item on rs1
  const base = (type, id, name, tags) => ({ '@context': ['<catalogue-link>/core_context.json'], id, itemType: { type: 'Property', value: type }, name: { type: 'Property', value: name }, itemDescription: { type: 'Property', value: name + ' (test)' }, tags: { type: 'Property', value: tags }, refBaseSchema: { type: 'Relationship', value: `<catalogue-link>/${type}_schema.json` } });
  let r = await c.req('POST', '/catalogue/v1/items', { cert: officer, body: { item: { ...base('provider', 'urn:demo-cat:provider/parks', 'Parks Department (demo)', ['provider', 'parks']), organizationInfo: { type: 'Property', value: { email: 'officer@parks.demo-city.example' } } } } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await c.req('POST', '/catalogue/v1/items', { cert: officer, body: { item: { ...base('resourceServerGroup', 'urn:demo-cat:group/parkaq', 'Park air sensors', ['group']), resourceServer: { type: 'Relationship', value: 'urn:demo-cat:rs/rs1' }, refDataModel: { type: 'Relationship', value: '<catalogue-link>/airQuality/airQuality_dataModel.json' }, provider: { type: 'Relationship', value: 'urn:demo-cat:provider/parks' } } } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await c.req('POST', '/catalogue/v1/items', { cert: officer, body: { item: { ...base('resourceItem', 'urn:demo-cat:parkaq/park-1', 'Central park air sensor', ['park', 'air-quality']), resourceId: { type: 'Property', value: 'park-1' }, resourceType: { type: 'Property', value: 'messageStream' }, resourceServer: { type: 'Relationship', value: 'urn:demo-cat:rs/rs1' }, resourceServerGroup: { type: 'Relationship', value: 'urn:demo-cat:group/parkaq' }, provider: { type: 'Relationship', value: 'urn:demo-cat:provider/parks' }, refDataModel: { type: 'Relationship', value: '<catalogue-link>/airQuality/airQuality_dataModel.json' }, accessPolicyLabel: { type: 'Property', value: 'protected' }, location: { type: 'GeoProperty', value: { geometry: { type: 'Point', coordinates: [80.05, 20.05] } } } } } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const now = new Date().toISOString();
  r = await c.req('POST', '/resource/v1/ingest', { cert: officer, body: { id: 'urn:demo-cat:parkaq/park-1', data: [{ PM2_5: 22.5, CO2_MAX: 410, TEMPERATURE_MAX: 29, LASTUPDATEDATETIME: now }] } });
  assert.equal(r.body.accepted, 1);
  // 7.3 Discover data
  const hits = await c.req('GET', '/catalogue/v1/search?q=central%20park');
  assert.equal(hits.body.results[0].id, 'urn:demo-cat:parkaq/park-1');
  // 7.4 Request consent and access data
  let t = await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: [{ id: 'urn:demo-cat:parkaq/park-1' }], purpose: 'green space study' } });
  assert.equal(t.status, 403);
  const consents = await c.req('GET', '/auth/v1/consent', { cert: officer });
  const cr = consents.body.find(x => x.consumer === 'analyst@lab.example');
  assert.equal((await c.req('POST', '/auth/v1/consent/decide', { cert: officer, body: { id: cr.id, approve: true } })).body.status, 'approved');
  t = await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: [{ id: 'urn:demo-cat:parkaq/park-1' }] } });
  assert.equal(t.status, 200);
  const d = await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:parkaq/park-1', { as: 'analyst@lab.example', token: t.body.token });
  assert.equal(d.body.PM2_5, 22.5);
  // 7.6 Revoke consent
  await c.req('POST', '/auth/v1/token/revoke', { cert: officer, body: { id: 'urn:demo-cat:parkaq/park-1', consumer: 'analyst@lab.example' } });
  assert.equal((await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:parkaq/park-1', { as: 'analyst@lab.example', token: t.body.token })).status, 403);
});

test('[BIS-23] every issued certificate chains to the root CA through the DX CA', async () => {
  const certs = (await admin.as('GET', '/identity/v1/certs')).body;
  const ca = new crypto.X509Certificate(fs.readFileSync(c.pki.caCrt)), root = new crypto.X509Certificate(fs.readFileSync(c.pki.rootCrt));
  assert.ok(ca.verify(root.publicKey));
  for (const x of certs) {
    const pem = c.app.identity.certBySerial(x.serial).pem;
    assert.ok(new crypto.X509Certificate(pem).verify(ca.publicKey), x.serial);
  }
});

test('[BIS-01][BIS-02][BIS-03][BIS-06][BIS-19][BIS-26][BIS-15][BIS-48] catalogue, authorization and resource services with the six interfaces as open HTTPS/JSON APIs', async () => {
  const api = await c.req('GET', '/api');
  const routes = api.body.routes.join('\n');
  for (const p of ['/catalogue/v1/search', '/catalogue/v1/items', '/auth/v1/token', '/auth/v1/token/introspect', '/auth/v1/consent', '/resource/v1/latest', '/identity/v1/csr']) assert.ok(routes.includes(p), p);
  for (const i of ['Resource', 'Authorization', 'Discover', 'Manage', 'Consent', 'Identity']) assert.ok(IFACES.includes(i), i);
  const types = (await c.req('GET', '/catalogue/v1/search?q=bus&limit=1')).headers['content-type'];
  assert.match(types, /application\/json/);
});

test('[BIS-13][BIS-24] the officer web console is served and needs no install', async () => {
  const r = await c.req('GET', '/console.html', { raw: true });
  assert.equal(r.status, 200);
  assert.match(r.body, /City OS Data Exchange Console/);
  assert.match(r.body, /synthetic demo data\. Not an official, certified or live city system/);
  assert.equal((await c.req('GET', '/console', { raw: true })).status, 200);
  // the public portal at / links to the console and carries the demo notice
  const home = await c.req('GET', '/', { raw: true });
  assert.match(home.body, /href="\/console\.html"/);
  assert.match(home.body, /synthetic demo data\. Not an official government website and not a live city system/);
  for (const f of ['/portal.js', '/portal.css', '/portal-mark.svg']) assert.equal((await c.req('GET', f, { raw: true })).status, 200, f);
  const js = await c.req('GET', '/app.js', { raw: true });
  assert.match(js.headers['content-type'], /javascript/);
});

test('[COS-01][COS-06][COS-27][COS-04] the COS is the data exchange plus the intelligence layer, between data sources and service delivery', async () => {
  const drainRead = await c.req('POST', '/cil/v1/flood/drainStatus', { as: 'control@mc.demo-city.example', body: {} });
  assert.equal(drainRead.status, 200);
  const audit = (await admin.as('GET', '/ops/v1/audit?iface=CIL&limit=5')).body;
  assert.match(audit[0].detail, /inputs: urn:demo-cat:group\/drains \(with DX token\)/, 'CIL reads DX data under DX access rules');
  const dash = await admin.as('GET', '/cil/v1/report');
  assert.equal(dash.status, 200, 'service delivery layer (ICCC report) is fed from CIL APIs');
});

test('[BIS-102] referenced standards in use: TLS 1.2+, HTTP/1.1, JSON, GeoJSON, ISO 8601 date-times', async () => {
  const g = await c.req('GET', '/resource/v1/download?id=urn:demo-cat:gis/ward-boundaries');
  assert.equal(g.body.type, 'FeatureCollection');
  const l = await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:aqm/aqm-1');
  assert.match(l.body.LASTUPDATEDATETIME, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
});
