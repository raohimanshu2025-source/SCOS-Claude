// Identity: TLS, certificate request process, classes, revocation, ID tokens (BIS 4.4, 5.1-5.4.2, 7.1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import tls from 'node:tls';
import { startCity } from './helpers.js';
import { mintIdToken } from '../src/identity/identity.js';

let c, admin;
before(async () => { c = await startCity(); admin = await c.login('admin'); });
after(async () => { await c.stop(); });

const csrFor = (subj) => execFileSync('openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', '/dev/null', '-subj', subj], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

test('[BIS-59][BIS-62] the server speaks TLS 1.2+ only and presents a certificate from the DX CA', async () => {
  const info = await new Promise((resolve, reject) => {
    const s = tls.connect({ host: '127.0.0.1', port: c.port, ca: c.ca, servername: 'localhost' }, () => { resolve({ proto: s.getProtocol(), issuer: s.getPeerCertificate().issuer.CN, authorized: s.authorized }); s.end(); });
    s.on('error', reject);
  });
  assert.ok(['TLSv1.2', 'TLSv1.3'].includes(info.proto));
  assert.equal(info.issuer, 'DX Certificate Authority (demo)');
  assert.equal(info.authorized, true);
  await assert.rejects(new Promise((resolve, reject) => { const s = tls.connect({ host: '127.0.0.1', port: c.port, ca: c.ca, servername: 'localhost', maxVersion: 'TLSv1.1', minVersion: 'TLSv1' }, resolve); s.on('error', reject); }));
});

test('[BIS-59] a client certificate from an untrusted CA is refused', async () => {
  const dir = fs.mkdtempSync('/tmp/untrusted-');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', dir + '/k', '-out', dir + '/c', '-days', '1', '-subj', '/CN=Mallory/emailAddress=control@mc.demo-city.example'], { stdio: 'ignore' });
  const r = await c.req('POST', '/auth/v1/token', { cert: { cert: fs.readFileSync(dir + '/c'), key: fs.readFileSync(dir + '/k') }, body: { request: [{ id: 'urn:demo-cat:drains/drain-1' }] } });
  assert.equal(r.status, 401); assert.match(r.body.error, /not from a trusted CA/);
  fs.rmSync(dir, { recursive: true });
});

test('[BIS-59] the trusted CA list is published', async () => {
  const r = await c.req('GET', '/identity/v1/trusted-cas');
  assert.equal(r.body.cas.length, 2);
  assert.ok(r.body.cas.every(x => x.pem.includes('BEGIN CERTIFICATE') && x.fingerprint));
  assert.equal(Object.keys(r.body.classes).length, 5);
});

test('[BIS-75][BIS-96][BIS-51][BIS-74] CSR by "e-mail": subject line, white-list and domain rules, admin approval, real X.509 issued', async () => {
  const badSubj = await c.req('POST', '/identity/v1/csr', { body: { subject: 'hello', csr: csrFor('/CN=New officer/emailAddress=new@wd.demo-city.example'), cls: 3, kind: 'officer' } });
  assert.equal(badSubj.status, 400); assert.match(badSubj.body.error, /Certificate request/);
  const notListed = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: csrFor('/CN=Someone/emailAddress=a@unlisted.example'), cls: 2, kind: 'emp' } });
  assert.equal(notListed.status, 403); assert.match(notListed.body.error, /not on the white-list/);
  const wrongDomain = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: csrFor('/CN=Someone/emailAddress=a@gmail.example'), cls: 4, kind: 'emp' } });
  assert.equal(wrongDomain.status, 403); assert.match(wrongDomain.body.error, /no registered organisation owns the domain/);
  const wrongClass = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: csrFor('/CN=Someone/emailAddress=b@wd.demo-city.example'), cls: 1, kind: 'emp' } });
  assert.equal(wrongClass.status, 400);
  const ok = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: csrFor('/CN=New drainage officer/emailAddress=new@wd.demo-city.example'), cls: 3, kind: 'officer' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.status, 'pending');
  const notAdmin = await c.req('POST', '/identity/v1/csr/decide', { as: 'officer@wd.demo-city.example', body: { id: ok.body.id, approve: true } });
  assert.equal(notAdmin.status, 403);
  const dec = await admin.as('POST', '/identity/v1/csr/decide', { body: { id: ok.body.id, approve: true } });
  assert.equal(dec.body.status, 'issued');
  const x = new (await import('node:crypto')).X509Certificate(dec.body.certificate);
  assert.match(x.issuer, /DX Certificate Authority/);
  assert.match(x.subject, /new@wd\.demo-city\.example/);
  assert.ok(x.verify(new (await import('node:crypto')).X509Certificate(fs.readFileSync(c.pki.caCrt)).publicKey));
});

test('[BIS-75] employee certificates need the organisation to hold an organisation certificate', async () => {
  // the lab is white-listed but has no organisation certificate
  const r = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: csrFor('/CN=Lab staff/emailAddress=staff@lab.example'), cls: 4, kind: 'emp' } });
  assert.equal(r.status, 403); assert.match(r.body.error, /holds no valid organisation certificate/);
});

test('[BIS-76] resource server certificates are class 1 with a DNS name under the organisation domain', async () => {
  const bad = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: csrFor('/CN=rs9.evil.example/emailAddress=admin@wd.demo-city.example'), cls: 1, kind: 'rs' } });
  assert.equal(bad.status, 400);
  const ok = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr: csrFor('/CN=rs9.wd.demo-city.example/emailAddress=admin@wd.demo-city.example'), cls: 1, kind: 'rs' } });
  assert.equal(ok.status, 200);
});

test('[BIS-65] revocation: certificate appears on the CRL, status says revoked, and every request with it is refused', async () => {
  const s = await c.req('GET', '/identity/v1/certs', { cookie: admin.cookie });
  const planner = s.body.find(x => x.email === 'planner@mc.demo-city.example');
  const before_ = await c.req('POST', '/auth/v1/token', { as: 'planner@mc.demo-city.example', body: { request: [{ id: 'urn:demo-cat:swm/waste-daily' }] } });
  assert.equal(before_.status, 200);
  const rv = await admin.as('POST', '/identity/v1/certs/revoke', { body: { serial: planner.serial, reason: 'keyCompromise' } });
  assert.equal(rv.body.status, 'revoked');
  const crl = await c.req('GET', '/identity/v1/crl');
  assert.ok(crl.body.revokedSerials.includes(planner.serial));
  const pem = await c.req('GET', '/identity/v1/crl.pem', { raw: true });
  assert.match(pem.body, /BEGIN X509 CRL/);
  const st = await c.req('GET', `/identity/v1/certs/status?serial=${planner.serial}`);
  assert.equal(st.body.status, 'revoked');
  const after_ = await c.req('GET', '/catalogue/v1/count', { as: 'planner@mc.demo-city.example' });
  assert.equal(after_.status, 403); assert.match(after_.body.error, /revoked/);
  const tok = await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:swm/waste-daily', { as: 'control@mc.demo-city.example', token: before_.body.token });
  assert.equal(tok.status, 403, 'tokens issued to the revoked certificate stop working');
});

test('[BIS-41] consumers may use an OpenID Connect style ID token; forged or foreign tokens are refused', async () => {
  const key = fs.readFileSync(c.pki.idpKey, 'utf8');
  const good = mintIdToken(key, { email: 'citizen@demo-mail.example', aud: 'dx.demo-city.example' });
  const me = await c.req('GET', '/auth/v1/me', { headers: { 'x-id-token': good } });
  assert.equal(me.body.principal.via, 'id-token'); assert.equal(me.body.principal.email, 'citizen@demo-mail.example');
  const tok = await c.req('POST', '/auth/v1/token', { headers: { 'x-id-token': good }, body: { request: [{ id: 'urn:demo-cat:fare/fare-revenue' }] } });
  assert.equal(tok.status, 403, 'protected data still needs consent'); assert.ok(tok.body.denied[0].consent);
  const { generateKeyPairSync } = await import('node:crypto');
  const forged = mintIdToken(generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { email: 'citizen@demo-mail.example', aud: 'dx.demo-city.example' });
  assert.equal((await c.req('GET', '/auth/v1/me', { headers: { 'x-id-token': forged } })).status, 401);
  const wrongAud = mintIdToken(key, { email: 'citizen@demo-mail.example', aud: 'other.example' });
  assert.equal((await c.req('GET', '/auth/v1/me', { headers: { 'x-id-token': wrongAud } })).status, 401);
  const expired = mintIdToken(key, { email: 'citizen@demo-mail.example', aud: 'dx.demo-city.example', ttlSec: -10 });
  assert.equal((await c.req('GET', '/auth/v1/me', { headers: { 'x-id-token': expired } })).status, 401);
});

test('[BIS-54] organisations can be registered and white-listed by the administrator only', async () => {
  const no = await c.req('POST', '/identity/v1/orgs', { as: 'officer@mc.demo-city.example', body: { id: 'newdept', name: 'New Dept', domain: 'new.demo-city.example' } });
  assert.equal(no.status, 403);
  const ok = await admin.as('POST', '/identity/v1/orgs', { body: { id: 'newdept', name: 'New Dept (demo)', domain: 'new.demo-city.example' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.whitelisted, 0);
  const wl = await admin.as('POST', '/identity/v1/orgs/whitelist', { body: { id: 'newdept', on: true } });
  assert.equal(wl.body.find(o => o.id === 'newdept').whitelisted, 1);
});
