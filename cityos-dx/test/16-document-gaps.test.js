// Points of the two documents closed after the strict audit: group operations, the organisation certificate
// script, the DNS check of resource servers and air quality forecast values with hotspots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { startCity } from './helpers.js';
import { orgCertificates } from '../scripts/org-certificates.js';
import { checkRsDns } from '../src/identity/dns-check.js';

let c;
before(async () => { c = await startCity(); });
after(async () => { await c.stop(); });

test('[BIS-124] latest, status and count can be asked of a whole resource group', async () => {
  const g = 'urn:demo-cat:group/aqm';
  const latest = await c.req('GET', '/resource/v1/latest?id=' + encodeURIComponent(g));
  assert.equal(latest.status, 200, JSON.stringify(latest.body));
  assert.equal(latest.body.group, g);
  assert.ok(latest.body.items >= 2 && latest.body.results.length === latest.body.items, 'every public sensor answers');
  assert.ok(latest.body.results.every(r => r.id && 'PM2_5' in r));
  assert.ok(latest.body.results.every(r => r.id.startsWith('urn:demo-cat:aqm/')), 'only members of the group');
  const st = await c.req('GET', '/resource/v1/status?id=' + encodeURIComponent(g));
  assert.ok(st.body.results.every(r => r.status && r.server));
  const cnt = await c.req('GET', '/resource/v1/count?id=' + encodeURIComponent(g));
  assert.ok(cnt.body.results.every(r => r.count > 0));
  assert.equal((await c.req('GET', '/resource/v1/search?id=' + encodeURIComponent(g))).status, 400, 'search stays per item');
  // a protected group: each item is still checked, and without a token every item is refused
  const pr = await c.req('GET', '/resource/v1/latest?id=' + encodeURIComponent('urn:demo-cat:group/drains'));
  assert.equal(pr.status, 200);
  assert.ok(pr.body.items > 0 && pr.body.results.length === 0 && pr.body.refused.every(r => r.status === 401));
});

test('[BIS-109] an organisation lists and decides its employees\' certificate requests with the DX script', async () => {
  const csr = execFileSync('openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', '/dev/null', '-subj', '/CN=New pump operator/emailAddress=pump@wd.demo-city.example'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const req = await c.req('POST', '/identity/v1/csr', { body: { subject: 'Certificate request', csr, cls: 4, kind: 'emp' } });
  assert.equal(req.status, 200, JSON.stringify(req.body));
  const conn = { url: `https://127.0.0.1:${c.port}`, ca: c.ca, servername: 'localhost', ...c.creds('dx@wd.demo-city.example') };
  const list = await orgCertificates(conn, 'list');
  assert.ok(list.some(x => x.id === req.body.id), 'the request is listed for its organisation');
  const other = await orgCertificates({ ...conn, ...c.creds('dx@mc.demo-city.example') }, 'list');
  assert.ok(!other.some(x => x.id === req.body.id), 'another organisation does not see it');
  const done = await orgCertificates(conn, 'approve', req.body.id);
  assert.equal(done.status, 'issued'); assert.ok(done.cert_serial);
  await assert.rejects(orgCertificates(conn, 'approve', req.body.id), /already/);
});

test('[BIS-113] Figure 2 step 8: a resource server is verified through DNS when the check is on', async () => {
  const fake = map => async h => { if (!map[h]) throw new Error('ENOTFOUND'); return map[h].map(address => ({ address })); };
  assert.deepEqual((await checkRsDns('rs1.city.example', '::ffff:10.0.0.5', fake({ 'rs1.city.example': ['10.0.0.5'] }))).addresses, ['10.0.0.5']);
  await assert.rejects(checkRsDns('rs1.city.example', '10.0.0.9', fake({ 'rs1.city.example': ['10.0.0.5'] })), /not to the caller 10\.0\.0\.9/);
  await assert.rejects(checkRsDns('rs1.city.example', '10.0.0.5', fake({})), /does not resolve/);
  // switched on in a running server: the demo resource server name does not resolve, so introspection is refused
  c.app.cfg.rsDnsCheck = true;
  try {
    const r = await c.req('POST', '/auth/v1/token/introspect', { as: 'admin@wd.demo-city.example', body: { token: 'x', id: 'y' } });
    assert.equal(r.status, 403); assert.match(r.body.error, /verified through DNS/);
  } finally { c.app.cfg.rsDnsCheck = false; }
});

test('[COS-16][COS-23] the air quality API forecasts future windows and reports hotspots', async () => {
  const ctl = await c.login('control');
  const now = Date.now(), iso = t => new Date(t).toISOString();
  const past = await ctl.as('POST', '/cil/v1/environment/spatialForecast', { body: { forecastStart: iso(now - 2 * 3600e3), forecastEnd: iso(now - 3600e3) } });
  assert.equal(past.status, 200, JSON.stringify(past.body));
  assert.equal(past.body.output.mode, 'observed');
  const fut = await ctl.as('POST', '/cil/v1/environment/spatialForecast', { body: { forecastStart: iso(now + 3600e3), forecastEnd: iso(now + 6 * 3600e3) } });
  assert.equal(fut.status, 200, JSON.stringify(fut.body));
  assert.equal(fut.body.output.mode, 'forecast');
  assert.ok(fut.body.output.sensors.every(s => s.forecastValues >= 1 && s.meanPM2_5 >= 0));
  assert.equal(fut.body.output.cells.length, 20);
  assert.ok(Array.isArray(fut.body.output.hotspots));
  for (const h of fut.body.output.hotspots) { assert.ok(h.PM2_5 > 90); assert.equal(h.centre.length, 2); }
});

test('[COS-37][COS-12] Figure 7 transit APIs: travel time by mode, metro and suburban rail arrivals, occupancy, with weather and events', async () => {
  const ctl = await c.login('control');
  const call = (path, body = {}) => ctl.as('POST', '/cil/v1/publictransit/' + path, { body });
  const tt = await call('travelTime', { origin: [77.2, 28.6], destination: [77.25, 28.62] });
  assert.equal(tt.status, 200, JSON.stringify(tt.body));
  assert.deepEqual(tt.body.output.rows.map(r => r.mode), ['walk', 'bicycle', 'autorickshaw', 'car']);
  const [walk, , , car] = tt.body.output.rows; assert.ok(walk.minutes > car.minutes, 'walking takes longer than a car');
  assert.ok('raining' in tt.body.output.conditions && 'floodAlertOnTrip' in tt.body.output.conditions);
  assert.equal((await call('travelTime', { origin: [1, 2], destination: [1, 2], mode: 'boat' })).status, 400);
  for (const mode of ['metro', 'suburban']) {
    const r = await call('railEta', { mode, station: mode === 'metro' ? 'Metro station 3' : 'Rail station 2' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.output.rows.length, 2, 'both directions');
    assert.ok(r.body.output.rows.every(x => /^\d\d:\d\d$|no more trains/.test(x.nextAt)));
  }
  const end = await call('railEta', { mode: 'metro', station: 'Metro station 1' });
  assert.equal(end.body.output.rows.length, 1, 'first station has one direction');
  assert.equal((await call('railEta', { mode: 'metro', station: 'Nowhere' })).status, 400);
  const occ = await call('occupancy');
  assert.deepEqual([...new Set(occ.body.output.rows.map(r => r.mode))].sort(), ['bus', 'metro', 'suburban']);
  assert.ok(occ.body.output.rows.every(r => ['low', 'medium', 'high'].includes(r.level) && Number.isFinite(r.nextHourPercent)));
  const eta = await call('eta', {});
  assert.equal(eta.status, 200); assert.ok('rainMm' in eta.body.output.conditions, 'bus ETA now reports the conditions it used');
});

test('[COS-15] bus versus metro financial performance', async () => {
  const ctl = await c.login('control');
  const r = await ctl.as('POST', '/cil/v1/publictransit/financialPerformance', { body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = Object.fromEntries(r.body.output.rows.map(x => [x.mode, x]));
  assert.ok(m.bus && m.metro);
  for (const x of [m.bus, m.metro]) assert.equal(x.fareboxRatio, Math.round(x.revenuePerDay / x.costPerDay * 100) / 100);
});

test('[BIS-37] media: live and archived playback and download of camera pictures, under the same access rules', async () => {
  const cam = 'urn:demo-cat:camera/cam-junction-5';
  const anon = await c.req('GET', '/resource/v1/media/latest?id=' + encodeURIComponent(cam));
  assert.equal(anon.status, 401, 'a protected camera needs a token');
  const tok = (await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: cam }] } })).body.token;
  assert.ok(tok, 'the control room may view the camera');
  const as = { as: 'control@mc.demo-city.example', token: tok };
  const list = await c.req('GET', '/resource/v1/media/list?id=' + encodeURIComponent(cam) + '&time=' + new Date(Date.now() - 3 * 3600e3).toISOString(), as);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.total >= 20, 'two hours of archived pictures');
  const latest = await c.req('GET', '/resource/v1/media/latest?id=' + encodeURIComponent(cam), { ...as, raw: true });
  assert.equal(latest.status, 200); assert.match(latest.headers['content-type'], /image\/svg\+xml/); assert.match(latest.body, /DEMO · synthetic picture/);
  assert.match(latest.headers['content-security-policy'], /sandbox/, 'pictures are served sandboxed');
  const f = list.body.files[0];
  const file = await c.req('GET', `/resource/v1/media/file?id=${encodeURIComponent(cam)}&ts=${encodeURIComponent(f.ts)}`, { ...as, raw: true });
  assert.equal(file.status, 200); assert.match(file.headers['content-disposition'], /attachment; filename=".+\.svg"/);
  // live: a multipart stream of pictures
  const live = await new Promise((resolve, reject) => {
    import('node:https').then(({ default: h }) => {
      const r = h.request({ host: '127.0.0.1', port: c.port, path: '/resource/v1/media/live?id=' + encodeURIComponent(cam), headers: { token: tok }, ca: c.ca, servername: 'localhost', ...c.creds('control@mc.demo-city.example') }, res => {
        let d = ''; res.on('data', x => { d += x; if (d.includes('</svg>')) { res.destroy(); resolve({ status: res.statusCode, type: res.headers['content-type'], body: d }); } });
      });
      r.on('error', reject); r.end();
    });
  });
  assert.equal(live.status, 200); assert.match(live.type, /multipart\/x-mixed-replace/); assert.match(live.body, /--dxframe/);
  // only the owner adds media, only to a media item, only allowed types
  const pic = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  assert.equal((await c.req('POST', '/resource/v1/media', { as: 'officer@mc.demo-city.example', body: { id: cam, mime: 'image/svg+xml', data: pic } })).status, 403);
  assert.equal((await c.req('POST', '/resource/v1/media', { as: 'officer@transport.demo-city.example', body: { id: cam, mime: 'text/html', data: pic } })).status, 400);
  assert.equal((await c.req('POST', '/resource/v1/media', { as: 'officer@transport.demo-city.example', body: { id: cam, mime: 'image/svg+xml', data: pic } })).status, 201);
});
