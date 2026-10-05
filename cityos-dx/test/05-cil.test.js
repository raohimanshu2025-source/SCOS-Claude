// City Intelligence Layer (City OS Sections 1-4, Figures 2, 8-13).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCity } from './helpers.js';

let c;
before(async () => { c = await startCity(); });
after(async () => { await c.stop(); });
const OP = 'control@mc.demo-city.example';

test('[COS-16][COS-17][COS-18][COS-19][COS-20][COS-21][COS-26][COS-02][COS-03] all 23 domain APIs answer for an authorised operator', async () => {
  const apis = (await c.req('GET', '/cil/v1/apis')).body;
  assert.equal(apis.length, 23);
  assert.deepEqual([...new Set(apis.map(a => a.domain))].sort(), ['Air Quality', 'Citizen Grievance', 'Flood', 'Intelligent Transit', 'Solid Waste', 'Weather']);
  for (const a of apis) {
    const r = await c.req('POST', '/cil/v1' + a.path, { as: OP, body: {} });
    assert.equal(r.status, 200, `${a.path}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.output && r.body.output.type, a.path);
  }
});

test('[COS-23] air quality API takes spatialRange, forecastStart, forecastEnd and returns a MeshGrid', async () => {
  const end = new Date(), start = new Date(Date.now() - 3600e3);
  const r = await c.req('POST', '/cil/v1/environment/spatialForecast', { body: { spatialRange: [80.0, 20.0, 80.1, 20.1], forecastStart: start.toISOString(), forecastEnd: end.toISOString() } });
  assert.equal(r.status, 200);
  assert.equal(r.body.output.type, 'MeshGrid'); assert.equal(r.body.output.cells.length, 20); assert.equal(r.body.output.cells[0].length, 20);
  const bad = await c.req('POST', '/cil/v1/environment/spatialForecast', { body: { forecastStart: end.toISOString(), forecastEnd: start.toISOString() } });
  assert.equal(bad.status, 400);
});

test('[COS-24][COS-12][COS-13] transit ETA takes routeid and current location and returns a Single Stat', async () => {
  const stops = (await c.req('GET', '/resource/v1/search?id=urn:demo-cat:stops/bus-stops')).body.results.filter(s => s.routeId === 'R-10');
  const r = await c.req('POST', '/cil/v1/publictransit/eta', { body: { routeid: 'R-10', currentlocation: stops[4].location.coordinates } });
  assert.equal(r.body.output.type, 'SingleStat'); assert.equal(r.body.output.unit, 'minutes');
  assert.equal(r.body.output.stop, 'S10-5'); assert.ok(r.body.output.value > 0);
});

test('[COS-22] every CIL API has an OpenAPI 3 description with ontology-specific bodies', async () => {
  const o = await c.req('GET', '/cil/v1/openapi?path=/environment/spatialForecast');
  assert.match(o.body.openapi, /^3\./);
  assert.deepEqual(Object.keys(o.body.paths['/environment/spatialForecast'].post.requestBody.content['application/json'].schema.properties).sort(), ['forecastEnd', 'forecastStart', 'spatialRange']);
  assert.equal(o.body.info['x-ontology'].OutputDataType, 'MeshGrid');
});

test('[COS-25][COS-07][COS-05] APIs with protected inputs need the caller to hold DX access; consent is requested otherwise', async () => {
  const anon = await c.req('POST', '/cil/v1/flood/drainStatus', { body: {} });
  assert.equal(anon.status, 401);
  const analyst = await c.req('POST', '/cil/v1/flood/drainStatus', { as: 'analyst@lab.example', body: {} });
  assert.equal(analyst.status, 403); assert.ok(analyst.body.denied.some(d => d.consent));
  const pub = await c.req('POST', '/cil/v1/publictransit/fleetPerformance', { body: {} });
  assert.equal(pub.status, 200, 'public inputs need no identity');
});

test('[COS-32][COS-33][COS-28][COS-14] plugging an analytic: ontology and schema matching refuse bad specs; a good one is live and scheduled', async () => {
  const good = { id: 'pm-ward', domain: 'Air Quality', name: 'Average PM2.5 by ward', path: '/environment/pmByWard', inputs: [{ group: 'aqm', type: 'Time Series', role: 'RequiresDataSource', attr: 'PM2_5' }], out: 'Table', viz: 'Bar', period: 15, dataPeriodicity: '15 min', procedure: 'Mean of the latest PM2.5 of the sensors in each ward', provenance: 'University Research Lab (demo)', operation: 'meanByWard', alertAbove: 80 };
  const badOnt = await c.req('POST', '/cil/v1/analytics', { as: 'analyst@lab.example', body: { ...good, id: 'bad-1', path: '/environment/badOne', out: 'Spreadsheet', inputs: [{ ...good.inputs[0], type: 'Excel' }] } });
  assert.equal(badOnt.status, 400); assert.match(badOnt.body.errors.join(), /not an ingress type.*|not an egress type/);
  const badSchema = await c.req('POST', '/cil/v1/analytics', { as: 'analyst@lab.example', body: { ...good, id: 'bad-2', path: '/environment/badTwo', inputs: [{ ...good.inputs[0], attr: 'NOISE_DB' }] } });
  assert.match(badSchema.body.errors.join(), /schema matching: attribute "NOISE_DB" is not in data model airQuality/);
  const noSpec = await c.req('POST', '/cil/v1/analytics', { as: 'analyst@lab.example', body: { ...good, id: 'bad-3', path: '/environment/badThree', procedure: '', provenance: '' } });
  assert.match(noSpec.body.errors.join(), /procedure description required.*provenance required/);
  const consumer = await c.req('POST', '/cil/v1/analytics', { as: 'planner@mc.demo-city.example', body: good });
  assert.equal(consumer.status, 403);
  const ok = await c.req('POST', '/cil/v1/analytics', { as: 'analyst@lab.example', body: good });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const r = await c.req('POST', '/cil/v1/environment/pmByWard', { body: {} });
  assert.equal(r.status, 200); assert.ok(r.body.output.rows.length >= 3);
  assert.equal((await c.req('GET', '/cil/v1/openapi?path=/environment/pmByWard')).body.info['x-ontology'].provenance, 'University Research Lab (demo)');
  const n = c.app.cil.tick(Date.now() + 3600e3 * 48);
  assert.ok(n >= 20, 'scheduler runs every analytic that is due, including the plugged one');
  assert.ok((await c.req('GET', '/cil/v1/apis')).body.find(a => a.id === 'pm-ward').runs >= 2);
});

test('[COS-28][COS-19] rule-based alerts are raised by analytics', async () => {
  await c.req('POST', '/cil/v1/flood/alerts', { as: OP, body: {} });
  const a = await c.req('GET', '/cil/v1/alerts');
  assert.ok(a.body.some(x => x.domain === 'Flood' && /Red|Amber/.test(x.msg)));
  assert.ok(a.body.some(x => x.domain === 'Intelligent Transit' && /off R-21/.test(x.msg)));
});

test('[COS-31] OLAP access pivots a measure over two dimensions under DX rules', async () => {
  const r = await c.req('POST', '/cil/v1/olap', { as: OP, body: { measure: 'griev', rows: 'ward', cols: 'cat' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.cells.flat().reduce((a, b) => a + b, 0), 180);
  assert.equal((await c.req('POST', '/cil/v1/olap', { body: { measure: 'griev' } })).status, 401);
});

test('[COS-29] natural-language questions are answered by calling CIL APIs', async () => {
  const q1 = await c.req('POST', '/cil/v1/ask', { as: OP, body: { question: 'What is the top grievance in ward 3?' } });
  assert.match(q1.body.answer, /top grievance in ward 3 is/); assert.equal(q1.body.api, '/grievance/wardTop');
  const q2 = await c.req('POST', '/cil/v1/ask', { body: { question: 'When is the next bus on route 21?' } });
  assert.equal(q2.body.api, '/publictransit/eta');
  const q3 = await c.req('POST', '/cil/v1/ask', { body: { question: 'Where is the air worst?' } });
  assert.match(q3.body.answer, /PM2\.5/);
});

test('[COS-30] ICCC monthly report on system performance', async () => {
  const s = await c.login('control');
  const r = await s.as('GET', '/cil/v1/report');
  assert.equal(r.status, 200);
  assert.ok(r.body.apiUse.length >= 19); assert.ok(r.body.alertsByDomain.length >= 1);
  assert.equal((await c.req('GET', '/cil/v1/report')).status, 401);
});

test('[COS-31] outputs are also available as NGSI-LD entities', async () => {
  const r = await c.req('POST', '/cil/v1/weather/windMap?format=ngsi-ld', { body: {} });
  assert.equal(r.body.type, 'AnalyticOutput'); assert.equal(r.body.result.type, 'Property'); assert.match(r.body.id, /^urn:ngsi-ld:AnalyticOutput:wx-wind:/);
});

test('[COS-08][COS-15][COS-34] federation: the same API asked of two cities with different data, then aggregated', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fed-'));
  const cityB = await startCity({ pkiDir: c.pki.dir, config: { cityName: 'Second Demo City' } });
  // make city B different: its buses all run late
  const late = (await cityB.req('GET', '/resource/v1/search?id=urn:demo-cat:itms/bus-101&limit=1000')).body.results.map(r => ({ ...r, delayMinutes: 12 }));
  await cityB.req('POST', '/resource/v1/ingest', { as: 'officer@transport.demo-city.example', body: { id: 'urn:demo-cat:itms/bus-101', data: late } });
  c.app.cfg.federationPeers = [`Second Demo City=https://localhost:${cityB.port}`];
  c.app.cfg.federationCaFile = c.pki.rootCrt;
  const r = await c.req('POST', '/cil/v1/federate', { body: { path: '/publictransit/fleetPerformance' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.cities.map(x => x.city), ['Demo City', 'Second Demo City']);
  assert.ok(r.body.cities.every(x => x.ok));
  const [a, b] = r.body.aggregate.perCity.map(x => x.value);
  assert.ok(a > b, 'city B is less regular');
  assert.equal(r.body.aggregate.mean, Math.round((a + b) / 2 * 10) / 10);
  await cityB.stop(); fs.rmSync(dir, { recursive: true, force: true });
  c.app.cfg.federationPeers = [];
});

test('[COS-09] a data collecting system (grievance aggregator) connects directly to the DX layer', async () => {
  const it = (await c.req('GET', '/catalogue/v1/items?id=urn:demo-cat:griev/grievance-records')).body;
  assert.equal(it.resourceServer.value, 'urn:demo-cat:rs/rs1');
  assert.equal(it.accessPolicyLabel.value, 'confidential');
});

test('[COS-33] analytics repository: domain and generic analytics are searchable; a generic one is customised with schema matching and a behaviour specification', async () => {
  const an = await c.login('analyst'); // a login session: the federation test above replaced the shared client certificate files
  const post = (u, body) => an.as('POST', u, { body });
  const all = (await c.req('GET', '/cil/v1/analytics/search')).body;
  assert.ok(all.some(a => a.repository === 'domain') && all.some(a => a.repository === 'generic'), 'both repositories');
  const gen = (await c.req('GET', '/cil/v1/analytics/search?repository=generic')).body;
  assert.ok(gen.length >= 4 && gen.every(a => a.repository === 'generic' && a.domain === null && !a.path));
  const air = (await c.req('GET', '/cil/v1/analytics/search?repository=domain&domain=Air%20Quality')).body;
  assert.ok(air.length >= 1 && air.every(a => a.domain === 'Air Quality'));
  assert.ok((await c.req('GET', '/cil/v1/analytics/search?q=ward%20maximum')).body.some(a => a.id === 'generic-max-by-ward'), 'word search');
  assert.ok((await c.req('GET', '/cil/v1/analytics/search?egress=Single%20Stat')).body.every(a => a.out === 'Single Stat'));
  // customise a generic analytic for air quality sensors: schema matching and the fit of input type and visualisation are checked
  const base = { template: 'generic-max-by-ward', id: 'pm-max', domain: 'Air Quality', name: 'Highest PM2.5 by ward', path: '/environment/pmMaxByWard', inputs: [{ group: 'aqm', attr: 'PM2_5' }], period: 10, dataPeriodicity: '10 min' };
  const badAttr = await post('/cil/v1/analytics/customize', { ...base, inputs: [{ group: 'aqm', attr: 'NOT_A_FIELD' }] });
  assert.equal(badAttr.status, 400); assert.match(badAttr.body.errors.join(), /schema matching/);
  const badViz = await post('/cil/v1/analytics/customize', { ...base, viz: 'Pie' });
  assert.match(badViz.body.errors.join(), /visualisation "Pie" does not fit/);
  const badType = await post('/cil/v1/analytics/customize', { ...base, inputs: [{ group: 'aqm', attr: 'PM2_5', type: 'Categorical' }] });
  assert.match(badType.body.errors.join(), /does not fit/);
  const badBh = await post('/cil/v1/analytics/customize', { ...base, behaviour: { trigger: 'sometimes', alert: { when: 'sideways' } } });
  assert.match(badBh.body.errors.join(), /behaviour.trigger.*behaviour.alert/);
  assert.equal((await post('/cil/v1/analytics/customize', { ...base, template: 'nope' })).status, 404);
  const ok = await post('/cil/v1/analytics/customize', { ...base, behaviour: { trigger: 'onRequest', onMissingInput: 'skip', minInputs: 1, alert: { when: 'above', value: 0 } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.template, 'generic-max-by-ward'); assert.equal(ok.body.repository, 'domain'); assert.equal(ok.body.behaviour.trigger, 'onRequest');
  const run = await c.req('POST', '/cil/v1/environment/pmMaxByWard', { body: {} });
  assert.equal(run.status, 200, JSON.stringify(run.body)); assert.ok(run.body.output.rows.length >= 1);
  assert.ok(run.body.alertsRaised >= 1, 'the behaviour alert rule raises alerts');
  // onRequest analytics are not run by the scheduler
  const before = (await c.req('GET', '/cil/v1/apis')).body.find(a => a.id === 'pm-max').runs;
  c.app.cil.tick(Date.now() + 3600e3 * 96);
  assert.equal((await c.req('GET', '/cil/v1/apis')).body.find(a => a.id === 'pm-max').runs, before);
  // a behaviour that fails when a ward has too few sensors
  const strict = await post('/cil/v1/analytics/customize', { ...base, id: 'pm-max-strict', path: '/environment/pmMaxStrict', behaviour: { onMissingInput: 'fail', minInputs: 50 } });
  assert.equal(strict.status, 200, JSON.stringify(strict.body));
  const sr = await c.req('POST', '/cil/v1/environment/pmMaxStrict', { body: {} });
  assert.equal(sr.status, 400); assert.match(sr.body.error, /fewer than 50 sensor/);
  const skip = await post('/cil/v1/analytics/customize', { ...base, id: 'pm-max-skip', path: '/environment/pmMaxSkip', behaviour: { onMissingInput: 'skip', minInputs: 50 } });
  assert.equal(skip.status, 200);
  const sk = (await c.req('POST', '/cil/v1/environment/pmMaxSkip', { body: {} })).body.output;
  assert.equal(sk.rows.length, 0); assert.ok(sk.leftOut.length >= 1, 'wards with too few sensors are left out and named');
  assert.ok((await c.req('GET', '/cil/v1/analytics/search?repository=domain&domain=Air%20Quality')).body.some(a => a.id === 'pm-max' && a.template === 'generic-max-by-ward'));
  assert.equal((await post('/cil/v1/analytics', { ...base, id: 'clash', path: '/analytics/search', operation: 'maxByWard', inputs: [{ group: 'aqm', attr: 'PM2_5', type: 'Time Series', role: 'RequiresDataSource' }], out: 'Table', viz: 'Bar', procedure: 'x', provenance: 'y' })).status, 400, 'CIL paths are reserved');
});
