// Checks added after the audit against the wording of the two documents (29-30 Sep 2026).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCity } from './helpers.js';

const ossl = (args, input) => execFileSync('openssl', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const newKeyCsr = subj => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dxk-')); const kf = path.join(d, 'k.pem'); const csr = ossl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', kf, '-subj', subj]); const key = fs.readFileSync(kf, 'utf8'); fs.rmSync(d, { recursive: true }); return { csr, key }; };

// A stand-in for a licensed CA (CCA): its own root, one client certificate, and a CRL revoking a second one.
const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'dx-licensed-ca-'));
function makeLicensedCa() {
  const f = n => path.join(ext, n);
  ossl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', f('ca.key'), '-out', f('ca.crt'), '-days', '30', '-subj', '/CN=Demo Licensed CA/O=Licensed CA (test stand-in)', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  fs.writeFileSync(f('index.txt'), ''); fs.writeFileSync(f('serial'), '1000\n'); fs.writeFileSync(f('crlnumber'), '01\n'); fs.mkdirSync(f('certs'));
  fs.writeFileSync(f('ca.cnf'), `[ ca ]\ndefault_ca = x\n[ x ]\ndir = ${ext}\ndatabase = $dir/index.txt\nserial = $dir/serial\ncrlnumber = $dir/crlnumber\nnew_certs_dir = $dir/certs\ncertificate = $dir/ca.crt\nprivate_key = $dir/ca.key\ndefault_md = sha256\ndefault_days = 30\ndefault_crl_days = 7\npolicy = p\nemail_in_dn = yes\n[ p ]\ncommonName = supplied\nemailAddress = optional\n[ leaf ]\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = clientAuth\n`);
  const issue = (name, subj) => { const k = newKeyCsr(subj); fs.writeFileSync(f(name + '.csr'), k.csr); ossl(['ca', '-config', f('ca.cnf'), '-batch', '-notext', '-extensions', 'leaf', '-in', f(name + '.csr'), '-out', f(name + '.crt')]); return { key: k.key, cert: fs.readFileSync(f(name + '.crt'), 'utf8') }; };
  const good = issue('good', '/CN=Citizen with licensed certificate/emailAddress=citizen@licensed.example');
  const bad = issue('bad', '/CN=Revoked citizen/emailAddress=revoked@licensed.example');
  ossl(['ca', '-config', f('ca.cnf'), '-revoke', f('bad.crt')]);
  ossl(['ca', '-config', f('ca.cnf'), '-gencrl', '-out', f('ca.crl')]);
  return { good, bad, caFile: f('ca.crt'), crlFile: f('ca.crl') };
}
const lic = makeLicensedCa();

let c, admin;
before(async () => { c = await startCity({ config: { trustedCaFile: lic.caFile, trustedCrlFile: lic.crlFile } }); admin = await c.login('admin'); });
after(async () => { await c.stop(); fs.rmSync(ext, { recursive: true, force: true }); });

const FARE = 'urn:demo-cat:fare/fare-revenue';
const AQ = 'urn:demo-cat:aqm/aqm-1';

test('[BIS-54][BIS-74] a certificate from a configured licensed CA is accepted over TLS as a class 2 identity; one on its CRL is refused', async () => {
  const me = await c.req('GET', '/auth/v1/me', { cert: lic.good });
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.principal.via, 'licensed-ca'); assert.equal(me.body.principal.cls, 2); assert.equal(me.body.principal.email, 'citizen@licensed.example');
  const cas = await c.req('GET', '/identity/v1/trusted-cas');
  assert.ok(cas.body.cas.some(x => /Demo Licensed CA/.test(x.subject) && /licensed CA/.test(x.source)));
  const tok = await c.req('POST', '/auth/v1/token', { cert: lic.good, body: { request: [{ id: FARE }], purpose: 'study' } });
  assert.equal(tok.status, 403); assert.ok(tok.body.denied[0].consent, 'class 2 may ask for protected data: consent request sent');
  const revoked = await c.req('GET', '/auth/v1/me', { cert: lic.bad });
  assert.equal(revoked.status, 403); assert.match(revoked.body.error, /revocation list/);
});

test('[BIS-104] the organisation certificate only grants certificates to employees: it cannot manage the catalogue, and it validates its own employees\' requests', async () => {
  const me = await c.req('GET', '/auth/v1/me', { as: 'dx@pcc.demo-city.example' });
  assert.equal(me.body.principal.role, 'organisation'); assert.equal(me.body.principal.cls, 0);
  const item = await c.req('POST', '/catalogue/v1/items', { as: 'dx@pcc.demo-city.example', body: { item: { id: 'urn:demo-cat:x/y' } } });
  assert.equal(item.status, 403);
  const data = await c.req('POST', '/auth/v1/token', { as: 'dx@pcc.demo-city.example', body: { request: [{ id: FARE }] } });
  assert.equal(data.status, 403);
  // an employee of PCC asks for a class 3 certificate (Class 3: "employees and data-officers"); PCC decides as registration authority
  const k = newKeyCsr('/CN=PCC analyst/emailAddress=analyst@pcc.demo-city.example');
  const r = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: k.csr, cls: 3, kind: 'emp' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const list = await c.req('GET', '/identity/v1/csr?status=pending', { as: 'dx@pcc.demo-city.example' });
  assert.ok(list.body.some(x => x.id === r.body.id)); assert.ok(list.body.every(x => x.org_id === 'pcc'));
  const otherOrg = await c.req('POST', '/identity/v1/csr/decide', { as: 'dx@wd.demo-city.example', body: { id: r.body.id, approve: true } });
  assert.equal(otherOrg.status, 403);
  const d = await c.req('POST', '/identity/v1/csr/decide', { as: 'dx@pcc.demo-city.example', body: { id: r.body.id, approve: true } });
  assert.equal(d.status, 200, JSON.stringify(d.body)); assert.equal(d.body.status, 'issued');
  const ind = newKeyCsr('/CN=Someone/emailAddress=someone@elsewhere.example');
  const ri = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: ind.csr, cls: 2, kind: 'ind' } });
  const notEmployee = await c.req('POST', '/identity/v1/csr/decide', { as: 'dx@pcc.demo-city.example', body: { id: ri.body.id, approve: true } });
  assert.equal(notEmployee.status, 403, 'an organisation decides only its own employees\' requests');
  // BIS 5.3: the new class 3 employee is in the same organisation but is not the owner of the officer's entries
  const cert = { cert: d.body.certificate, key: k.key };
  const upd = await c.req('PUT', `/catalogue/v1/items?id=${encodeURIComponent(AQ)}`, { cert, body: { item: { tags: { type: 'Property', value: ['x'] } } } });
  assert.equal(upd.status, 403); assert.match(upd.body.error, /DN of the certificate that created them/);
});

test('[BIS-58][BIS-99] Figure 2: "Authorization: IUDX <token>" is accepted and introspection carries the policy reference', async () => {
  const t = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: 'urn:demo-cat:drains/drain-1' }] } });
  assert.equal(t.status, 200); assert.equal(t.body['token-type'], 'IUDX'); assert.equal(t.body['expires-in'], 3600);
  const r = await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:drains/drain-1', { as: 'control@mc.demo-city.example', headers: { authorization: 'IUDX ' + t.body.token } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const i = await c.req('POST', '/auth/v1/token/introspect', { as: 'admin@wd.demo-city.example', body: { token: t.body.token } });
  assert.equal(i.status, 200, JSON.stringify(i.body));
  assert.deepEqual(Object.keys(i.body).slice(0, 4), ['consumer', 'consumer-certificate-class', 'expiry', 'request']);
  assert.match(i.body.policy, /urn:demo-cat:drains\/drain-1#v\d+/);
});

test('[BIS-100][BIS-33] Figure 11: the provider revokes with body {"token"}; Table 2 Manage: create, delete and view policies, list consumers', async () => {
  const t = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: 'urn:demo-cat:drains/drain-1' }] } });
  const notOwner = await c.req('POST', '/auth/v1/token/revoke', { as: 'officer@pcc.demo-city.example', body: { token: t.body.token } });
  assert.equal(notOwner.status, 403);
  const rv = await c.req('POST', '/auth/v1/token/revoke', { as: 'officer@wd.demo-city.example', body: { token: t.body.token } });
  assert.equal(rv.status, 200, JSON.stringify(rv.body)); assert.equal(rv.body.revoked, 1);
  const after_ = await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:drains/drain-1', { as: 'control@mc.demo-city.example', token: t.body.token });
  assert.equal(after_.status, 403);
  const consumers = await c.req('GET', '/auth/v1/consumers', { as: 'officer@wd.demo-city.example' });
  assert.equal(consumers.status, 200); assert.ok(consumers.body.some(x => x.consumer === 'control@mc.demo-city.example' && x.certificateClass === 5));
  const one = await c.req('GET', '/auth/v1/consumers?email=control@mc.demo-city.example', { as: 'officer@wd.demo-city.example' });
  assert.ok(one.body.onPolicy.includes('urn:demo-cat:drains/drain-1'));
  const post = await c.req('POST', '/auth/v1/acl', { as: 'officer@wd.demo-city.example', body: { id: 'urn:demo-cat:drains/drain-2', C: ['planner@mc.demo-city.example'] } });
  assert.equal(post.status, 200, JSON.stringify(post.body)); assert.deepEqual(post.body.C, ['planner@mc.demo-city.example']);
  const del = await c.req('DELETE', '/auth/v1/acl?id=urn:demo-cat:drains/drain-2', { as: 'officer@wd.demo-city.example' });
  assert.equal(del.status, 200); assert.deepEqual(del.body.C, []);
});

test('[BIS-72] Table 4 is published cell by cell, including Nature of data, Consent and Data Monetization', async () => {
  const v = await c.req('GET', '/catalogue/v1/policy-vocabulary');
  assert.equal(v.body.table4.public.natureOfData, 'Information which can be made available to the public. It shall not contain any personally identifiable information');
  assert.equal(v.body.table4.protected.dataAudit, 'Random audit');
  assert.equal(v.body.table4.confidential.dataMonetization, 'NA');
  assert.equal(v.body.table3Names.authProtocol, 'Authorization protocol and policy');
});

test('[BIS-77][BIS-79] Discover events are in the audit log; the status page reports each endpoint and each resource server', async () => {
  await c.req('GET', '/catalogue/v1/search?q=drain');
  const a = await admin.as('GET', '/ops/v1/audit?iface=Discover&limit=5');
  assert.equal(a.status, 200); assert.ok(a.body.some(e => e.iface === 'Discover' && e.action === 'Search'), JSON.stringify(a.body).slice(0, 300));
  const s = await c.req('GET', '/status/v1');
  assert.ok(s.body.endpoints.some(e => e.endpoint === '/catalogue/v1/search' && e.requests >= 1 && e.avgResponseMs !== null));
  assert.ok(s.body.resourceServers.length >= 2 && s.body.resourceServers.every(r => ['up', 'down'].includes(r.status)));
});

test('[BIS-107] an organisation may add employee details (organisation, unit, first and last name, role, state, city) and they stay in the certificate', async () => {
  const k = newKeyCsr('/CN=Ward engineer/O=Pollution Control Committee/OU=Monitoring/GN=Asha/SN=Verma/title=Engineer/ST=Demo State/L=Demo City/emailAddress=engineer@pcc.demo-city.example');
  const r = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: k.csr, cls: 2, kind: 'emp' } });
  const d = await c.req('POST', '/identity/v1/csr/decide', { as: 'dx@pcc.demo-city.example', body: { id: r.body.id, approve: true } });
  const text = ossl(['x509', '-noout', '-subject', '-nameopt', 'RFC2253'], d.body.certificate);
  for (const part of ['O=Pollution Control Committee', 'OU=Monitoring', 'GN=Asha', 'SN=Verma', 'title=Engineer', 'ST=Demo State', 'L=Demo City']) assert.ok(text.includes(part), part + ' in ' + text);
});

test('[BIS-120][BIS-121][BIS-87] base schemas and contexts are served (not as catalogue items); quantities may be numbers, numeric strings or arrays', async () => {
  const s = await c.req('GET', '/catalogue/v1/schemas?type=resourceItem');
  assert.equal(s.status, 200); assert.ok(s.body.required.includes('resourceServerGroup'));
  const ctx = await c.req('GET', '/catalogue/v1/context?name=core');
  assert.ok(ctx.body['@context'].QuantitativeProperty);
  const list = await c.req('GET', '/catalogue/v1/list');
  assert.ok(!list.body.some(id => /schema|context/.test(id)));
  const { validateItem } = await import('../src/dx/model.js');
  const q = v => validateItem({ '@context': ['x'], id: 'urn:demo-cat:t/q', itemType: { type: 'Property', value: 'catalogueItem' }, name: { type: 'Property', value: 'n' }, tags: { type: 'Property', value: [] }, refBaseSchema: { type: 'Relationship', value: '<catalogue-link>/catalogueItem_schema.json' }, itemDescription: { type: 'Property', value: 'd' }, capacity: { type: 'QuantitativeProperty', value: v } });
  assert.deepEqual(q(12), []); assert.deepEqual(q('12.5'), []); assert.deepEqual(q([1, '2']), []);
  assert.equal(q('12 kg').length, 1, 'non-numeric characters are not accepted');
});

test('[BIS-119] Figure 8 step 4: HTTPS POST /auth/1.0/acl body=<policy>', async () => {
  const r = await c.req('POST', '/auth/1.0/acl', { as: 'officer@wd.demo-city.example', body: { id: 'urn:demo-cat:drains/drain-3', C: ['control@mc.demo-city.example'] } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.C.includes('control@mc.demo-city.example'));
});
