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
