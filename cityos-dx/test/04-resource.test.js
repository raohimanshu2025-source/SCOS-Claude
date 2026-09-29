// Resource interface, DX Adapter, subscriptions, ingestion (BIS Table 2, 4.5.2.3, 5.6, 6.4.2).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { startCity } from './helpers.js';

let c, ctl;
before(async () => { c = await startCity(); ctl = (await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: 'urn:demo-cat:drains/drain-3' }] } })).body.token; });
after(async () => { await c.stop(); });

const AQ = 'urn:demo-cat:aqm/aqm-2';

test('[BIS-36] latest, search (time, attribute, bbox), status and count', async () => {
  const l = await c.req('GET', `/resource/v1/latest?id=${AQ}`);
  assert.ok(l.body['@context'].includes('airQuality'));
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const s = await c.req('GET', `/resource/v1/search?id=${AQ}&time=${since}&timerel=after`);
  assert.ok(s.body.total >= 11 && s.body.total <= 13);
  const hi = await c.req('GET', `/resource/v1/search?id=${AQ}&attr=PM2_5&op=gt&value=100`);
  assert.ok(hi.body.results.every(r => r.PM2_5 > 100));
  const during = await c.req('GET', `/resource/v1/search?id=${AQ}&time=${since}&endtime=${new Date(Date.now() - 3600e3).toISOString()}&timerel=during`);
  assert.ok(during.body.total > 0 && during.body.total < s.body.total);
  const bb = await c.req('GET', '/resource/v1/search?id=urn:demo-cat:stops/bus-stops&bbox=80.0,20.0,80.05,20.1');
  assert.ok(bb.body.results.every(r => r.location.coordinates[0] <= 80.05));
  assert.equal((await c.req('GET', `/resource/v1/status?id=${AQ}`)).body.status, 'active');
  assert.equal((await c.req('GET', `/resource/v1/count?id=${AQ}`)).body.count, 96);
});

test('[BIS-91] packets use the compact key-value form; types come from the data model', async () => {
  const l = await c.req('GET', `/resource/v1/latest?id=${AQ}`);
  assert.equal(typeof l.body.PM2_5, 'number');
  assert.equal(typeof l.body.CO2_MAX, 'number');
});

test('[BIS-56][BIS-49] legacy server behind the DX Adapter: token checks and translation from its CSV columns', async () => {
  const csv = c.app.resource.legacyCsv('urn:demo-cat:drains/drain-3', 'drainLevel');
  assert.match(csv.split('\n')[0], /^LVL_M,FLOW_CUMECS,CAP_M,TS_UTC$/);
  const noTok = await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:drains/drain-3', { as: 'control@mc.demo-city.example' });
  assert.equal(noTok.status, 401);
  const r = await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:drains/drain-3&trace=1', { as: 'control@mc.demo-city.example', token: ctl });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).filter(k => !['@context', 'id', 'authorizationFlow'].includes(k)).sort(), ['capacity', 'flow', 'level', 'observationDateTime']);
  assert.match(r.body.authorizationFlow[0].text, /via DX Adapter/);
});

test('[BIS-69] a view shares counts without personal data', async () => {
  const t = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: 'urn:demo-cat:grievview/grievance-counts' }] } });
  const v = await c.req('GET', '/resource/v1/search?id=urn:demo-cat:grievview/grievance-counts&limit=500', { as: 'control@mc.demo-city.example', token: t.body.token });
  assert.ok(v.body.total > 5);
  assert.ok(v.body.results.every(r => !('citizenName' in r) && !('phone' in r) && typeof r.count === 'number'));
  assert.equal(v.body.results.reduce((a, r) => a + r.count, 0), 180);
});

test('[BIS-37] GIS file download as GeoJSON', async () => {
  const g = await c.req('GET', '/resource/v1/download?id=urn:demo-cat:gis/ward-boundaries');
  assert.equal(g.body.type, 'FeatureCollection'); assert.equal(g.body.features.length, 9);
  assert.equal(g.body.features[0].geometry.type, 'Polygon');
});

test('[BIS-36] subscribe, receive packets by server-sent events, update and unsubscribe', async () => {
  const s = await c.req('POST', '/resource/v1/subscription', { as: 'analyst@lab.example', body: { id: AQ, every: 1 } });
  assert.equal(s.status, 200);
  const events = await new Promise((resolve, reject) => {
    const got = [];
    const req = https.request({ host: '127.0.0.1', port: c.port, path: s.body.stream, ca: c.ca, servername: 'localhost', ...c.creds('analyst@lab.example') }, res => {
      assert.equal(res.headers['content-type'], 'text/event-stream');
      res.on('data', d => { got.push(String(d)); if (got.join('').includes('event: packet')) { req.destroy(); resolve(got.join('')); } });
    });
    req.on('error', e => (e.code === 'ECONNRESET' ? null : reject(e)));
    req.end();
    setTimeout(() => reject(new Error('no event')), 5000);
  });
  assert.match(events, /event: packet\ndata: \{.*"PM2_5"/);
  const u = await c.req('PATCH', '/resource/v1/subscription', { as: 'analyst@lab.example', body: { sid: s.body.subscriptionId, every: 30 } });
  assert.equal(u.body.every_sec, 30);
  const other = await c.req('DELETE', `/resource/v1/subscription?sid=${s.body.subscriptionId}`, { as: 'dev@apps.example' });
  assert.equal(other.status, 404, 'cannot touch someone else\'s subscription');
  assert.equal((await c.req('DELETE', `/resource/v1/subscription?sid=${s.body.subscriptionId}`, { as: 'analyst@lab.example' })).status, 200);
});

test('[BIS-20][BIS-17] provider pushes data checked against the data model; bad packets refused', async () => {
  const t = new Date().toISOString();
  const bad = await c.req('POST', '/resource/v1/ingest', { as: 'officer@pcc.demo-city.example', body: { id: AQ, data: [{ PM2_5: 'high', LASTUPDATEDATETIME: t }, { PM2_5: 5000, LASTUPDATEDATETIME: t }, { NOISE: 3, LASTUPDATEDATETIME: t }] } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.errors.length, 3);
  const notOwner = await c.req('POST', '/resource/v1/ingest', { as: 'officer@wd.demo-city.example', body: { id: AQ, data: [{ PM2_5: 50, LASTUPDATEDATETIME: t }] } });
  assert.equal(notOwner.status, 403);
  const ok = await c.req('POST', '/resource/v1/ingest', { as: 'officer@pcc.demo-city.example', body: { id: AQ, data: [{ PM2_5: 51.5, CO2_MAX: 430, TEMPERATURE_MAX: 30, NAME: 'Air quality sensor 2', LASTUPDATEDATETIME: t }] } });
  assert.equal(ok.body.accepted, 1);
  assert.equal((await c.req('GET', `/resource/v1/latest?id=${AQ}`)).body.PM2_5, 51.5);
});

test('[BIS-83][BIS-10] resource server down: 503 with retry; other servers keep working; recovers', async () => {
  const admin = await c.login('admin');
  await admin.as('POST', '/ops/v1/service', { body: { service: 'urn:demo-cat:rs/rs2', up: false } });
  const d = await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:drains/drain-3', { as: 'control@mc.demo-city.example', token: ctl });
  assert.equal(d.status, 503); assert.equal(d.body.retry, true);
  assert.equal((await c.req('GET', `/resource/v1/latest?id=${AQ}`)).status, 200, 'rs1 unaffected');
  await admin.as('POST', '/ops/v1/service', { body: { service: 'urn:demo-cat:rs/rs2', up: true } });
  assert.equal((await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:drains/drain-3', { as: 'control@mc.demo-city.example', token: ctl })).status, 200);
});
