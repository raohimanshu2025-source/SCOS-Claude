// Operations: status page, heartbeat, statistics, signed audit log, backups, notifications, security headers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startCity } from './helpers.js';
import { verifyBackup } from '../src/ops/ops.js';
import { openDb } from '../src/db.js';
import { makeAudit } from '../src/audit.js';

let c, admin;
before(async () => { c = await startCity({ config: { rateLimitPerMin: 100000 } }); admin = await c.login('admin'); });
after(async () => { await c.stop(); });

test('[BIS-79][BIS-82] public status page: uptime, average response time and latency per interface; heartbeat API', async () => {
  for (let i = 0; i < 5; i++) await c.req('GET', '/catalogue/v1/search?q=bus');
  c.app.ops.beat();
  const s = await c.req('GET', '/status/v1');
  const cat = s.body.services.find(x => x.service === 'catalogue');
  assert.equal(cat.status, 'up'); assert.equal(cat.uptimePercent, 100);
  assert.ok(cat.requests >= 5); assert.ok(cat.avgResponseMs >= 0); assert.ok(cat.p95LatencyMs >= 0);
  assert.equal(s.body.services.length, 6);
  const h = await c.req('GET', '/status/v1/heartbeat');
  assert.equal(h.body.services.authorization, 'up'); assert.ok(h.body.uptimeSec >= 0);
  await admin.as('POST', '/ops/v1/service', { body: { service: 'cil', up: false } });
  assert.equal((await c.req('GET', '/status/v1/heartbeat')).body.services.cil, 'down');
  const s2 = await c.req('GET', '/status/v1');
  assert.ok(s2.body.services.find(x => x.service === 'cil').uptimePercent < 100, 'down time is counted');
  await admin.as('POST', '/ops/v1/service', { body: { service: 'cil', up: true } });
});

test('[BIS-77][BIS-05] every interface logs events and exposes statistics', async () => {
  const st = await admin.as('GET', '/ops/v1/stats');
  const ifaces = st.body.audit.map(x => x.iface);
  for (const i of ['Manage', 'Identity', 'Operations']) assert.ok(ifaces.includes(i), i);
  await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: 'urn:demo-cat:drains/drain-1' }] } });
  await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: [{ id: 'urn:demo-cat:fare/fare-revenue' }] } });
  await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:aqm/aqm-1');
  await c.req('POST', '/cil/v1/weather/windMap', { body: {} });
  const st2 = await admin.as('GET', '/ops/v1/stats');
  for (const i of ['Authorization', 'Consent', 'Resource', 'CIL']) assert.ok(st2.body.audit.some(x => x.iface === i), i);
  assert.ok(st2.body.tokens.issued >= 1);
});

test('[BIS-11][BIS-12] audit log is hash-chained and Ed25519-signed; tampering is detected', async () => {
  const v = await admin.as('GET', '/ops/v1/audit/verify');
  assert.equal(v.body.ok, true); assert.ok(v.body.checked > 100);
  const pk = await c.req('GET', '/ops/v1/audit/public-key');
  assert.match(pk.body.publicKeyPem, /BEGIN PUBLIC KEY/);
  // tamper with a copy of the database
  const b = await admin.as('POST', '/ops/v1/backup', { body: { label: 'tamper' } });
  const file = path.join(c.app.cfg.backupDir, b.body.file);
  const raw = new DatabaseSync(file); raw.prepare(`UPDATE audit SET detail='nothing happened' WHERE seq=5`).run(); raw.close();
  const db2 = openDb(file); const a2 = makeAudit(db2, fs.readFileSync(c.pki.auditKey, 'utf8'));
  const res = a2.verify(); db2.close();
  assert.equal(res.ok, false); assert.equal(res.brokenAt, 5);
});

test('[BIS-78] backup while running: consistent copy, integrity check, can be restored and served', async () => {
  const b = await admin.as('POST', '/ops/v1/backup', { body: { label: 'nightly' } });
  assert.equal(b.status, 200);
  assert.equal(b.body.check.integrity, 'ok');
  assert.equal(b.body.check.counts.items, 58);
  const list = await admin.as('GET', '/ops/v1/backups');
  assert.ok(list.body.some(x => x.file === b.body.file));
  const file = path.join(c.app.cfg.backupDir, b.body.file);
  assert.equal((fs.statSync(file).mode & 0o777), 0o600, 'backup readable by the service account only');
  assert.equal(verifyBackup(file).integrity, 'ok');
  // restore into a new city and check the audit chain still verifies
  const db2 = openDb(file); const a2 = makeAudit(db2, fs.readFileSync(c.pki.auditKey, 'utf8'));
  assert.equal(a2.verify().ok, true); db2.close();
});

test('[BIS-80] notification service paused: notices queue and are delivered later', async () => {
  await admin.as('POST', '/ops/v1/service', { body: { service: 'notification', up: false } });
  await c.req('POST', '/auth/v1/token', { as: 'dev@apps.example', body: { request: [{ id: 'urn:demo-cat:fare/fare-revenue' }], purpose: 'queue test' } });
  const down = await c.req('GET', '/notify/v1/inbox', { as: 'officer@transport.demo-city.example' });
  assert.equal(down.body.available, false); assert.ok(down.body.queued >= 1);
  await admin.as('POST', '/ops/v1/service', { body: { service: 'notification', up: true } });
  const up = await c.req('GET', '/notify/v1/inbox', { as: 'officer@transport.demo-city.example' });
  assert.ok(up.body.notices.some(n => n.msg.includes('queue test')));
});

test('security headers on every response; static files cannot escape the public folder', async () => {
  const r = await c.req('GET', '/status/v1/heartbeat');
  assert.match(r.headers['strict-transport-security'], /max-age=/);
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  const esc = await c.req('GET', '/..%2f..%2fpackage.json');
  assert.equal(esc.status, 404);
});

test('rate limiting answers 429 when a client floods the server', async () => {
  const d = await startCity({ config: { rateLimitPerMin: 20 } });
  let last;
  for (let i = 0; i < 25; i++) last = await d.req('GET', '/status/v1/heartbeat');
  assert.equal(last.status, 429);
  await d.stop();
});

test('malformed input is refused cleanly, never a crash', async () => {
  assert.equal((await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: '{not json' })).status, 400);
  assert.equal((await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: 'x' } })).status, 400);
  assert.equal((await c.req('GET', '/catalogue/v1/search?q=' + encodeURIComponent("' OR 1=1 --"))).status, 200);
  assert.equal((await c.req('GET', '/resource/v1/latest?id=nope')).status, 404);
  assert.equal((await c.req('POST', '/cil/v1/nothing/here', { body: {} })).status, 404);
  assert.equal((await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: 'x'.repeat(1_100_000) })).status, 413);
});
