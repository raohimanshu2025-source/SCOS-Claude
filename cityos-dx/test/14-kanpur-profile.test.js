// Kanpur profile (an addition beyond the two documents): 11 Kanpur departments with synthetic demo data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCity } from './helpers.js';
import { DEPARTMENTS } from '../src/seed-kanpur.js';

let c;
before(async () => { c = await startCity({ config: { cityProfile: 'kanpur' } }); });
after(async () => { await c.stop(); });

test('Kanpur profile seeds 11 departments, each with an officer and a staff login', async () => {
  assert.equal(DEPARTMENTS.length, 11);
  assert.equal(c.app.cfg.cityName, 'Kanpur (demo data)');
  for (const [id] of DEPARTMENTS) {
    const o = await c.login('officer.' + id); const s = await c.login('staff.' + id);
    assert.equal((await o.as('GET', '/auth/v1/me')).body.account.role, 'provider', id);
    assert.equal((await s.as('GET', '/auth/v1/me')).body.account.role, 'consumer', id);
  }
  const mine = (await (await c.login('officer.kesco')).as('GET', '/catalogue/v1/mine')).body;
  assert.ok(JSON.stringify(mine).includes('feeders'), 'KESCO officer sees its feeders');
});

test('all 23 CIL analytics answer on the Kanpur data, with Kanpur departments as providers', async () => {
  const ctl = await c.login('control');
  const apis = (await c.req('GET', '/cil/v1/apis')).body;
  assert.equal(apis.length, 23);
  assert.ok(apis.every(a => !/demo city/i.test(a.provider)), JSON.stringify(apis.map(a => a.provider)));
  for (const a of apis) {
    const r = await ctl.as('POST', '/cil/v1' + a.path, { body: {} });
    assert.equal(r.status, 200, `${a.path}: ${JSON.stringify(r.body)}`);
  }
});

test('cross-department access follows the policies: allowed on the policy, consent request otherwise', async () => {
  const kjs = await c.login('staff.kjs');
  const ok = await kjs.as('POST', '/auth/v1/token', { body: { request: [{ id: 'urn:demo-cat:feeders/feeder-2' }], purpose: 'test' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const read = await kjs.as('GET', '/resource/v1/latest?id=urn:demo-cat:feeders/feeder-2', { token: ok.body.token });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  const fire = await c.login('staff.fire');
  const no = await fire.as('POST', '/auth/v1/token', { body: { request: [{ id: 'urn:demo-cat:pumps/sps-2' }], purpose: 'test' } });
  assert.equal(no.status, 403);
  assert.match(no.body.error, /consent request/);
});

test('the public portal can read what it shows without a login, and nothing protected', async () => {
  const pub = ['urn:demo-cat:aqm/aqm-1', 'urn:demo-cat:beds/beds-1', 'urn:demo-cat:water/water-supply-daily', 'urn:demo-cat:roadworks/road-works', 'urn:demo-cat:outages/power-cut-notices'];
  for (const id of pub) assert.equal((await c.req('GET', '/resource/v1/search?id=' + encodeURIComponent(id))).status, 200, id);
  assert.equal((await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:feeders/feeder-1')).status, 401);
  assert.equal((await c.req('POST', '/cil/v1/publictransit/fleetPerformance', { body: {} })).status, 200);
  assert.equal((await c.req('POST', '/cil/v1/flood/drainStatus', { body: {} })).status, 401);
});

test('power cut notices for the citizen button are public and follow the powerNotice model', async () => {
  const r = await c.req('GET', '/resource/v1/search?id=' + encodeURIComponent('urn:demo-cat:outages/power-cut-notices'));
  assert.equal(r.status, 200);
  const rows = r.body.results ?? r.body;
  assert.ok(Array.isArray(rows) && rows.length >= 4, JSON.stringify(r.body).slice(0, 200));
  for (const n of rows) for (const k of ['noticeId', 'area', 'zone', 'from', 'to', 'status']) assert.ok(n[k] != null, k);
});

test('past incident register: 52 public news incidents from the build set, each with a source link and no held-back incident', async () => {
  const r = await c.req('GET', '/resource/v1/search?id=' + encodeURIComponent('urn:demo-cat:incidents/past-incidents-news'));
  assert.equal(r.status, 200);
  const rows = r.body.results ?? r.body;
  assert.equal(rows.length, 52);
  for (const x of rows) { assert.match(x.incidentId, /^KI-\d{3}$/); assert.match(x.sourceUrl, /^https:\/\//); assert.ok(!/\(/.test(x.departments), x.departments); }
  const fs = await import('node:fs');
  const ids = new Set(JSON.parse(fs.readFileSync(new URL('../src/seed-data/kanpur-incidents-build.json', import.meta.url), 'utf8')).map(o => o.incidentId));
  assert.deepEqual(new Set(rows.map(x => x.incidentId)), ids);
});
