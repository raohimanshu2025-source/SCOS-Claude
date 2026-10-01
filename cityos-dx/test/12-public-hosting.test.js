// Hosting the demo for officials: a public web certificate for browsers, and separate demo logins.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { startCity } from './helpers.js';

// A stand-in for a public web CA (such as Let's Encrypt) and a certificate it issued for localhost.
const web = fs.mkdtempSync(path.join(os.tmpdir(), 'dx-web-ca-'));
const f = n => path.join(web, n);
const ossl = args => execFileSync('openssl', args, { stdio: ['pipe', 'pipe', 'pipe'] });
ossl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', f('ca.key'), '-out', f('ca.crt'), '-days', '30', '-subj', '/CN=Demo Public Web CA']);
ossl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', f('site.key'), '-out', f('site.csr'), '-subj', '/CN=localhost']);
fs.writeFileSync(f('ext.cnf'), 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
ossl(['x509', '-req', '-in', f('site.csr'), '-CA', f('ca.crt'), '-CAkey', f('ca.key'), '-CAcreateserial', '-days', '30', '-extfile', f('ext.cnf'), '-out', f('site.crt')]);

let c;
before(async () => { c = await startCity({ config: { publicTlsCert: f('site.crt'), publicTlsKey: f('site.key') } }); });
after(async () => { await c.stop(); fs.rmSync(web, { recursive: true, force: true }); });

const get = (p, opts) => new Promise((resolve, reject) => {
  const r = https.request({ host: '127.0.0.1', port: c.port, path: p, servername: 'localhost', ...opts }, res => {
    const peer = res.socket.getPeerCertificate(); let d = ''; res.on('data', x => (d += x)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d), peer }));
  });
  r.on('error', reject); r.end();
});

test('with a public web certificate, browsers trusting that CA reach the server, and DX client certificates still identify the caller', async () => {
  const pub = await get('/status/v1/heartbeat', { ca: fs.readFileSync(f('ca.crt')) });
  assert.equal(pub.status, 200); assert.equal(pub.peer.issuer.CN, 'Demo Public Web CA');
  const me = await get('/auth/v1/me', { ca: fs.readFileSync(f('ca.crt')), ...c.creds('officer@transport.demo-city.example') });
  assert.equal(me.status, 200); assert.equal(me.body.principal.email, 'officer@transport.demo-city.example'); assert.equal(me.body.principal.cls, 3);
  await assert.rejects(get('/status/v1/heartbeat', { ca: fs.readFileSync(c.pki.rootCrt) }), /certificate/, 'the DX root no longer signs the web certificate');
});

test('demo logins: the administrator can get a different password from the other demo accounts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cityos-dx-seed-'));
  const app = createApp({ dataDir: path.join(dir, 'data'), pkiDir: path.join(dir, 'pki'), backupDir: path.join(dir, 'b'), schedulerEnabled: false, simulator: false, heartbeatMs: 3600e3 });
  try {
    const r = seed(app, { password: 'Guest-demo-2026', adminPassword: 'Admin-secret-2026' });
    assert.equal(r.passwords.admin, 'Admin-secret-2026');
    assert.equal(r.passwords['officer.transport'], 'Guest-demo-2026'); assert.equal(r.passwords.control, 'Guest-demo-2026');
  } finally { app.db.close?.(); fs.rmSync(dir, { recursive: true, force: true }); }
});
