// Test harness: a fresh PKI, database and seeded demo city per test file, served over real HTTPS.
// Clients connect with the X.509 certificates the DX CA issued during seeding (mutual TLS).
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { seedKanpur } from '../src/seed-kanpur.js';
import { pkiPaths } from '../src/identity/ca.js';

export const PASSWORD = 'Test-password-2026';
const sharedPki = path.join(os.tmpdir(), 'cityos-dx-test-pki'); // one PKI for the whole run keeps tests fast

export async function startCity(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cityos-dx-'));
  const pkiDir = opts.pkiDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cityos-dx-pki-'));
  const app = createApp({ dataDir: path.join(dir, 'data'), pkiDir, backupDir: path.join(dir, 'backups'), schedulerEnabled: false, simulator: false, heartbeatMs: 3600e3, schedulerMinuteMs: 60000, mqttPort: 0, ...opts.config });
  const seeded = (app.cfg.cityProfile === 'kanpur' ? seedKanpur : seed)(app, { password: PASSWORD });
  const addr = await app.listen(0, '127.0.0.1');
  const pki = pkiPaths(pkiDir);
  const ca = [fs.readFileSync(pki.rootCrt)];
  const creds = email => { const b = path.join(pki.clients, email.replace(/[^\w.@-]/g, '_')); return { cert: fs.readFileSync(b + '.crt'), key: fs.readFileSync(b + '.key') }; };

  // One HTTPS request. `as` is a holder e-mail (client certificate), or null for no certificate.
  function req(method, url, { as = null, body, token, headers = {}, cookie, cert, raw = false } = {}) {
    return new Promise((resolve, reject) => {
      const h = { ...headers };
      if (body !== undefined) h['content-type'] = 'application/json';
      if (token) h.token = token;
      if (cookie) h.cookie = cookie;
      const r = https.request({ host: '127.0.0.1', port: addr.port, method, path: url, headers: h, ca, servername: 'localhost', ...(cert || (as ? creds(as) : {})) }, res => {
        let d = ''; res.on('data', c => (d += c));
        res.on('end', () => { let json = null; try { json = JSON.parse(d); } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, body: raw ? d : json ?? d }); });
      });
      r.on('error', reject);
      if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
      r.end();
    });
  }
  async function login(username, password = PASSWORD) {
    const r = await req('POST', '/auth/v1/login', { body: { username, password } });
    if (r.status !== 200) throw new Error('login failed: ' + JSON.stringify(r.body));
    const cookie = r.headers['set-cookie'][0].split(';')[0];
    return { cookie, csrf: r.body.csrf, as: (m, u, o = {}) => req(m, u, { ...o, cookie, headers: { 'x-csrf-token': r.body.csrf, ...(o.headers || {}) } }) };
  }
  async function stop() { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); if (!opts.pkiDir) fs.rmSync(pkiDir, { recursive: true, force: true }); }
  return { app, req, login, stop, port: addr.port, pki, creds, ca, seeded, dir };
}
export { sharedPki };
