// State-level and sector-wise reports and central access rules (City OS Section 1, Figure 2; Section 4).
// Two cities, one state node and one national node, each a separate server over real HTTPS.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCity } from './helpers.js';

let a, b, state, nation;
// All nodes share one PKI so they trust each other; the client certificate files on disk belong to the node seeded
// last, so each test makes requests with certificates only on the node started most recently.
before(async () => {
  a = await startCity();
  const fed = { federationCaFile: a.pki.rootCrt };
  state = await startCity({ pkiDir: a.pki.dir, config: { ...fed, tier: 'state', regionName: 'Demo State', cityName: 'State node' } });
  nation = await startCity({ pkiDir: a.pki.dir, config: { ...fed, tier: 'national', regionName: 'Demo Nation', cityName: 'National node', federationPeers: [`Demo State=https://localhost:${state.port}`] } });
  b = await startCity({ pkiDir: a.pki.dir, config: { cityName: 'Second Demo City' } });
  state.app.cfg.federationPeers = [`Demo City=https://localhost:${a.port}`, `Second Demo City=https://localhost:${b.port}`];
});
after(async () => { for (const x of [nation, state, b, a]) await x?.stop(); });

test('[COS-34] a city publishes sector-wise performance figures as a public item in its own data exchange', async () => {
  const r = await a.req('GET', '/cil/v1/reports/region');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.level, 'city'); assert.equal(r.body.name, 'Demo City');
  assert.deepEqual(r.body.sectors.map(s => s.sector), ['Transport', 'Solid waste', 'Flood and drainage', 'Environment', 'Citizen services']);
  const k = Object.fromEntries(r.body.kpis.map(x => [x.kpi, x.value]));
  assert.ok(k['Buses on time'] > 0 && k['Bus farebox ratio'] > 0 && k['Waste expected tomorrow'] > 0, JSON.stringify(k));
  assert.ok(r.body.kpis.every(x => x.value !== null), 'every figure computed from protected inputs by the CIL service identity');
  // the figures are a DX resource item anyone can read, so other COSs reach them through the data exchange
  const item = (await a.req('GET', '/catalogue/v1/search?q=city-performance&type=resourceItem')).body.results[0];
  assert.equal(item.accessPolicyLabel.value, 'public');
  const latest = await a.req('GET', '/resource/v1/latest?id=' + encodeURIComponent(item.id));
  assert.equal(latest.status, 200);
  const pk = Array.isArray(latest.body.results) ? latest.body.results[0] : latest.body;
  assert.equal(pk.city, 'Demo City'); assert.equal(pk.kpis.length, 10);
  assert.equal((await b.req('POST', '/cil/v1/reports/city-figures')).status, 401, 'only the control room or administrator recomputes on demand');
});

test('[COS-08][COS-34] a state node reads each city through its data exchange; a national node reads the state; same output at every level', async () => {
  // city B: buses late and more drains on alert, so the cities differ
  const late = (await b.req('GET', '/resource/v1/search?id=urn:demo-cat:itms/bus-101&limit=1000')).body.results.map(r => ({ ...r, delayMinutes: 12 }));
  await b.req('POST', '/resource/v1/ingest', { as: 'officer@transport.demo-city.example', body: { id: 'urn:demo-cat:itms/bus-101', data: late } });
  const ctl = await b.login('control');
  assert.equal((await ctl.as('POST', '/cil/v1/reports/city-figures')).status, 200);
  const s = await state.req('GET', '/cil/v1/reports/region');
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.level, 'state'); assert.equal(s.body.name, 'Demo State');
  assert.deepEqual(s.body.members.map(m => [m.name, m.ok, m.level]), [['Demo City', true, 'city'], ['Second Demo City', true, 'city']]);
  assert.ok(s.body.members.every(m => m.via.startsWith('data exchange of ')), 'read through the cities\' data exchanges');
  const onTime = s.body.kpis.find(x => x.kpi === 'Buses on time');
  const [va, vb] = onTime.perMember.map(x => x.value);
  assert.ok(va > vb); assert.equal(onTime.best, 'Demo City'); assert.equal(onTime.worst, 'Second Demo City');
  assert.equal(onTime.value, Math.round((va + vb) / 2 * 100) / 100, 'percent figures are averaged');
  const waste = s.body.kpis.find(x => x.kpi === 'Waste expected tomorrow');
  assert.equal(waste.value, Math.round((waste.perMember[0].value + waste.perMember[1].value) * 10) / 10, 'tonnes are added');
  const n = await nation.req('GET', '/cil/v1/reports/region');
  assert.equal(n.body.level, 'national');
  assert.equal(n.body.members[0].name, 'Demo State'); assert.equal(n.body.members[0].level, 'state');
  assert.deepEqual(n.body.members[0].members.map(m => m.name), ['Demo City', 'Second Demo City']);
  assert.equal(n.body.kpis.find(x => x.kpi === 'Buses on time').value, onTime.value);
  assert.deepEqual(Object.keys(n.body).sort(), Object.keys(s.body).sort(), 'common output shape');
  // a city that is down is shown as not answering; the rest still report
  const down = await startCity({ pkiDir: a.pki.dir, config: { federationCaFile: a.pki.rootCrt, tier: 'state', regionName: 'Other State', federationPeers: ['Gone City=https://localhost:1', `Demo City=https://localhost:${a.port}`] } });
  const d = await down.req('GET', '/cil/v1/reports/region');
  assert.deepEqual(d.body.members.map(m => m.ok), [false, true]);
  await down.stop();
});

test('[COS-08] central access rules set at state level narrow access in each city, and are logged', async () => {
  const sAdmin = await state.login('admin');
  const c = await startCity({ pkiDir: a.pki.dir, config: { cityName: 'Third Demo City' } });
  assert.equal((await (await c.login('admin')).as('PUT', '/ops/v1/central-policy', { body: { blockedConsumers: [] } })).status, 409, 'a city node does not set central rules');
  assert.equal((await sAdmin.as('PUT', '/ops/v1/central-policy', { body: { labelClasses: { secret: [5] } } })).status, 400);
  const put = await sAdmin.as('PUT', '/ops/v1/central-policy', { body: { blockedConsumers: ['analyst@lab.example'], labelClasses: { confidential: [5] }, maxTokenTtlSec: 600, note: 'demo rule' } });
  assert.equal(put.status, 200, JSON.stringify(put.body)); assert.equal(put.body.version, 1);
  // before city A follows the state, the analyst's consent request still goes to the provider
  const before_ = await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: [{ id: 'urn:demo-cat:fare/fare-revenue' }] } });
  assert.ok(before_.body.denied?.[0].consent, JSON.stringify(before_.body));
  c.app.cfg.centralPolicyUrl = `https://localhost:${state.port}`; c.app.cfg.federationCaFile = a.pki.rootCrt;
  const pulled = await c.app.central.pull();
  assert.equal(pulled.version, 1); assert.equal(pulled.issuer, 'Demo State');
  const blocked = await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: [{ id: 'urn:demo-cat:fare/fare-revenue' }] } });
  assert.equal(blocked.status, 403); assert.match(blocked.body.error, /central access rules of Demo State/); assert.equal(blocked.body.denied[0].consent, undefined, 'no consent request is raised');
  // public data stays open; tokens are capped at the state's maximum life
  assert.equal((await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:aqm/aqm-1')).status, 200);
  const t = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: 'urn:demo-cat:drains/drain-1' }] } });
  assert.equal(t.status, 200); assert.ok(t.body['expires-in'] <= 600);
  const pub = await c.req('GET', '/ops/v1/central-policy');
  assert.equal(pub.body.applied.version, 1); assert.equal(pub.body.source, `https://localhost:${state.port}`);
  const log = await (await c.login('admin')).as('GET', '/ops/v1/audit?iface=Authorization&limit=300');
  assert.ok(log.body.some(e => e.action === 'Central access rules applied' && e.detail.includes('Demo State')));
  // the state node going down keeps the last rules: access does not open up
  c.app.cfg.centralPolicyUrl = 'https://localhost:1';
  assert.equal((await c.app.central.pull()).version, 1);
  assert.equal((await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: [{ id: 'urn:demo-cat:fare/fare-revenue' }] } })).status, 403);
  await c.stop();
});
