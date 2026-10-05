// BIS 5.6 reliability: several worker processes on one port, and a standby server that copies the database and
// takes over through the front door when the primary stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { startCity, PASSWORD } from './helpers.js';
import { createApp } from '../src/server.js';
import { seed } from '../src/seed.js';
import { pkiPaths } from '../src/identity/ca.js';
import { makeStandby } from '../src/ha/standby.js';
import { signReplica, checkReplicaAuth } from '../src/ha/replica.js';
import { makeFrontDoor } from '../deploy/ha-frontdoor.js';

const ROOT = new URL('..', import.meta.url).pathname;
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 100)); } };
function call(port, ca, method, url, { body, cookie, csrf, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers }; if (body) h['content-type'] = 'application/json'; if (cookie) h.cookie = cookie; if (csrf) h['x-csrf-token'] = csrf;
    const r = https.request({ agent: false, host: '127.0.0.1', port, method, path: url, headers: h, ca, servername: 'localhost' }, res => {
      let d = ''; res.on('data', x => (d += x));
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, body: j ?? d }); });
    });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
const login = async (port, ca, username) => { const r = await call(port, ca, 'POST', '/auth/v1/login', { body: { username, password: PASSWORD } }); assert.equal(r.status, 200, JSON.stringify(r.body)); return { cookie: r.headers['set-cookie'][0].split(';')[0], csrf: r.body.csrf }; };

test('[BIS-78] scaling: several worker processes share one port; sessions, pause switches and the audit chain work across them', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cityos-dx-cluster-'));
  const env = { ...process.env, DX_DATA_DIR: path.join(dir, 'data'), DX_PKI_DIR: path.join(dir, 'pki'), DX_BACKUP_DIR: path.join(dir, 'backups'), DX_HOST: '127.0.0.1',
    DX_MQTT_PORT: '0', DX_AMQP_PORT: '0', DX_SIMULATOR: 'false', DX_SCHEDULER: 'false', DX_HEARTBEAT_MS: '3600000' };
  const app = createApp({ dataDir: env.DX_DATA_DIR, pkiDir: env.DX_PKI_DIR, backupDir: env.DX_BACKUP_DIR, mqttPort: -1, amqpPort: -1 });
  seed(app, { password: PASSWORD }); await app.close();
  const port = await freePort();
  const ca = [fs.readFileSync(pkiPaths(env.DX_PKI_DIR).rootCrt)];
  const child = spawn(process.execPath, ['--no-warnings', 'src/cluster.js'], { cwd: ROOT, env: { ...env, DX_PORT: String(port), DX_WORKERS: '3' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => (out += d)); child.stderr.on('data', d => (out += d));
  try {
    await until(() => (out.match(/ready on/g) || []).length === 3, 30000);
    assert.match(out, /3 worker process/); assert.match(out, /worker 1 \(leader\) ready/);
    // requests are spread over the workers
    const seen = new Set();
    for (let i = 0; i < 30; i++) seen.add((await call(port, ca, 'GET', '/status/v1/heartbeat')).headers['x-dx-instance']);
    assert.ok(seen.size >= 2, 'expected answers from more than one worker, got ' + [...seen].join(', '));
    // a session made on one worker is accepted by all of them
    const s = await login(port, ca, 'admin');
    const who = new Set();
    for (let i = 0; i < 12; i++) { const r = await call(port, ca, 'GET', '/auth/v1/me', s); assert.equal(r.body.principal.username, 'admin'); who.add(r.headers['x-dx-instance']); }
    assert.ok(who.size >= 2);
    // pausing a service on one worker pauses it on all of them (BIS 5.6 failure testing)
    assert.equal((await call(port, ca, 'POST', '/ops/v1/service', { ...s, body: { service: 'cil', up: false } })).status, 200);
    const down = new Set();
    for (let i = 0; i < 12; i++) { const r = await call(port, ca, 'GET', '/status/v1/heartbeat'); assert.equal(r.body.services.cil, 'down'); down.add(r.headers['x-dx-instance']); }
    assert.ok(down.size >= 2);
    await call(port, ca, 'POST', '/ops/v1/service', { ...s, body: { service: 'cil', up: true } });
    // many writes at once from different workers keep one unbroken, signed audit chain
    const burst = await Promise.all(Array.from({ length: 80 }, (_, i) => call(port, ca, 'POST', '/auth/v1/login', { body: { username: 'officer.' + i, password: 'wrong-password' } })));
    assert.deepEqual([...new Set(burst.map(x => x.status))], [401], 'every refused login is answered and logged, none fails with a server error');
    const v = await call(port, ca, 'GET', '/ops/v1/audit/verify', s);
    assert.equal(v.status, 200); assert.equal(v.body.ok, true, JSON.stringify(v.body));
  } finally {
    child.kill('SIGTERM'); await new Promise(r => child.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('[BIS-78] high availability: the standby copies the database, takes over when the primary stops, and the front door moves clients to it', { timeout: 90000 }, async () => {
  const KEY = 'test-replication-key-' + Date.now();
  // the replication signature: right key and fresh time only
  assert.ok(checkReplicaAuth(KEY, signReplica(KEY)));
  assert.ok(!checkReplicaAuth(KEY, signReplica('other-key')));
  assert.ok(!checkReplicaAuth(KEY, signReplica(KEY, Date.now() - 120e3)));
  const pkiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cityos-dx-ha-pki-'));
  const sbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cityos-dx-standby-'));
  const c = await startCity({ pkiDir, config: { replicationKey: KEY } });
  const sbPort = await freePort(), fdPort = await freePort();
  const fd = makeFrontDoor({ ports: [fdPort], healthMs: 150, failAfter: 2, host: '127.0.0.1', log: () => {},
    targets: [{ name: 'primary', host: '127.0.0.1', ports: { [fdPort]: c.port } }, { name: 'standby', host: '127.0.0.1', ports: { [fdPort]: sbPort } }] });
  const logs = [];
  const sb = makeStandby({ primaryUrl: `https://127.0.0.1:${c.port}`, key: KEY, primaryName: 'localhost', pullMs: 200, failAfter: 2, port: sbPort, host: '127.0.0.1', log: m => logs.push(m),
    overrides: { dataDir: path.join(sbDir, 'data'), pkiDir, backupDir: path.join(sbDir, 'backups'), schedulerEnabled: false, simulator: false, heartbeatMs: 3600e3, mqttPort: 0, amqpPort: 0 } });
  let primaryUp = true;
  try {
    await fd.listen();
    // without the key, or with a wrong one, the primary refuses to send its database
    assert.equal((await c.req('GET', '/ops/v1/replica/snapshot')).status, 401);
    assert.equal((await c.req('GET', '/ops/v1/replica/snapshot', { headers: { 'x-dx-replica': signReplica('wrong') } })).status, 401);
    // clients reach the primary through the front door; a session is made there
    const ca = c.ca;
    let r = await call(fdPort, ca, 'GET', '/status/v1/heartbeat');
    assert.equal(r.status, 200); assert.equal(r.body.role, 'primary');
    const s = await login(fdPort, ca, 'admin');
    // a change on the primary, then a pull: the standby's copy has it and passes the integrity check
    assert.equal((await call(fdPort, ca, 'POST', '/ops/v1/service', { ...s, body: { service: 'notification', up: false } })).status, 200);
    const check = await sb.pull();
    assert.equal(check.integrity, 'ok'); assert.ok(check.counts.audit > 0);
    const copy = new DatabaseSync(path.join(sbDir, 'data', 'dx.sqlite'), { readOnly: true });
    assert.equal(copy.prepare("SELECT v FROM kv WHERE k='switch:notification'").get().v, 'false');
    assert.ok(copy.prepare('SELECT COUNT(*) n FROM sessions').get().n >= 1);
    copy.close();
    const replica = await call(fdPort, ca, 'GET', '/ops/v1/replica', s);
    assert.equal(replica.body.enabled, true); assert.ok(replica.body.lastSnapshot.at);
    // the primary stops: the standby misses two pulls, takes over, and the front door moves to it
    sb.start();
    await c.stop(); primaryUp = false;
    await until(() => sb.state.promoted);
    assert.ok(logs.some(l => /promoted to primary/.test(l)));
    await until(async () => { await fd.check(); return fd.state.active === 1; });
    assert.equal(fd.state.switches[0].from, 'primary'); assert.equal(fd.state.switches[0].to, 'standby');
    // the same address now answers from the standby, with the same data: the old session still works
    r = await call(fdPort, ca, 'GET', '/status/v1/heartbeat');
    assert.equal(r.body.role, 'standby (promoted)'); assert.equal(r.body.services.notification, 'down');
    const me = await call(fdPort, ca, 'GET', '/auth/v1/me', s);
    assert.equal(me.status, 200); assert.equal(me.body.principal.username, 'admin');
    // the takeover is in the signed audit chain, which is still unbroken
    const v = await call(fdPort, ca, 'GET', '/ops/v1/audit/verify', s);
    assert.equal(v.body.ok, true);
    const a = await call(fdPort, ca, 'GET', '/ops/v1/audit?iface=Operations', s);
    assert.ok(a.body.some(e => e.action === 'Standby promoted to primary'));
  } finally {
    await fd.close(); await sb.stop(); if (primaryUp) await c.stop();
    fs.rmSync(sbDir, { recursive: true, force: true }); fs.rmSync(pkiDir, { recursive: true, force: true });
  }
});
