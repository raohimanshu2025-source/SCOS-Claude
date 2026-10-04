// Demo city set-up: organisations, certificates, officer accounts, catalogue and SYNTHETIC data.
// All names, places and readings are made up. Run once: npm run seed (prints where the passwords were written).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { q } from './db.js';
import { iso, round } from './util.js';
import { pkiPaths } from './identity/ca.js';
import { seedKanpur } from './seed-kanpur.js';
import { seedTransit } from './seed-transit.js';
import { cameraFrame } from './media-frames.js';

let seedVal = 20230727;
const rnd = () => { seedVal = (seedVal * 1664525 + 1013904223) % 4294967296; return seedVal / 4294967296; };
const P = v => ({ type: 'Property', value: v }), Rl = v => ({ type: 'Relationship', value: v }), G = g => ({ type: 'GeoProperty', value: { geometry: g } });

const ORGS = [
  ['mc', 'Municipal Corporation (demo)', 'mc.demo-city.example'],
  ['pcc', 'Pollution Control Cell (demo)', 'pcc.demo-city.example'],
  ['tr', 'City Transport Undertaking (demo)', 'transport.demo-city.example'],
  ['wd', 'Water and Drainage Department (demo)', 'wd.demo-city.example'],
  ['cs', 'Citizen Services Cell (demo)', 'cs.demo-city.example'],
  ['dev', 'Transit Apps Studio (demo app developer)', 'apps.example'],
  ['lab', 'University Research Lab (demo)', 'lab.example'],
];
const HOLDERS = [
  // [email, cn, cls, kind]
  ...['mc', 'pcc', 'transport', 'wd', 'cs'].map(d => [`dx@${d}.demo-city.example`, `${d.toUpperCase()} organisation certificate`, 0, 'org']),
  ['admin@mc.demo-city.example', 'rs1.mc.demo-city.example', 1, 'rs'],
  ['admin@wd.demo-city.example', 'rs2-adapter.wd.demo-city.example', 1, 'rs'],
  ['officer@pcc.demo-city.example', 'Air quality data officer', 3, 'officer'],
  ['officer@transport.demo-city.example', 'Transit data officer', 3, 'officer'],
  ['officer@wd.demo-city.example', 'Drainage data officer', 3, 'officer'],
  ['officer@cs.demo-city.example', 'Citizen services data officer', 3, 'officer'],
  ['officer@mc.demo-city.example', 'Municipal data officer', 3, 'officer'],
  ['analyst@lab.example', 'Research analyst', 2, 'ind'],
  ['dev@apps.example', 'Transit app developer', 2, 'ind'],
  ['planner@mc.demo-city.example', 'Ward planner', 4, 'emp'],
  ['control@mc.demo-city.example', 'Control room operator', 5, 'emp'],
  ['cil@mc.demo-city.example', 'City Intelligence Layer service', 5, 'emp'],
];
const ACCOUNTS = [
  // [username, role, cert email or null, display name]
  ['admin', 'admin', null, 'DX administrator'],
  ['auditor', 'auditor', null, 'Auditor (read only)'],
  ['officer.pcc', 'provider', 'officer@pcc.demo-city.example', 'Air quality data officer'],
  ['officer.transport', 'provider', 'officer@transport.demo-city.example', 'Transit data officer'],
  ['officer.wd', 'provider', 'officer@wd.demo-city.example', 'Drainage data officer'],
  ['officer.cs', 'provider', 'officer@cs.demo-city.example', 'Citizen services data officer'],
  ['officer.mc', 'provider', 'officer@mc.demo-city.example', 'Municipal data officer'],
  ['planner', 'consumer', 'planner@mc.demo-city.example', 'Ward planner'],
  ['control', 'operator', 'control@mc.demo-city.example', 'Control room operator'],
  ['analyst', 'analytics_provider', 'analyst@lab.example', 'Research analyst'],
  ['developer', 'consumer', 'dev@apps.example', 'Transit app developer'],
];

export function seed(app, { password, adminPassword, now = Date.now() } = {}) {
  const { db, identity, accounts, catalogue, authz, resource, cfg } = app;
  if (q.get(db, 'SELECT 1 FROM orgs LIMIT 1')) throw new Error('database already seeded');
  seedVal = 20230727;
  const pki = pkiPaths(cfg.pkiDir);
  for (const [id, name, domain] of ORGS) identity.registerOrg({ id, name, domain, whitelisted: true }, 'seed');
  identity.registerOrg({ id: 'unlisted', name: 'Unlisted Company (demo)', domain: 'unlisted.example', whitelisted: false }, 'seed');
  const certs = {};
  for (const [email, cn, cls, kind] of HOLDERS) {
    const c = identity.issueDirect({ cn, email, cls, kind });
    certs[email] = identity.certBySerial(c.serial);
    const base = path.join(pki.clients, email.replace(/[^\w.@-]/g, '_'));
    fs.writeFileSync(base + '.crt', c.pem); fs.writeFileSync(base + '.key', c.keyPem, { mode: 0o600 });
  }
  const pw = {};
  for (const [u, role, email, dn] of ACCOUNTS) {
    const given = role === 'admin' && adminPassword ? adminPassword : password;
    pw[u] = given || crypto.randomBytes(9).toString('base64url') + '9';
    accounts.create({ username: u, password: pw[u], role, certSerial: email ? certs[email].serial : null, displayName: dn, mustChange: !given }, 'seed');
  }
  const as = email => { const c = certs[email]; return { via: 'seed', email: c.email, cn: c.cn, cls: c.cls, serial: c.serial, dn: c.dn, kind: c.kind, orgId: c.org_id, role: 'provider' }; };

  // ---- geography: 3 x 3 synthetic wards ----
  const B = { w: 80.0, s: 20.0, e: 80.1, n: 20.1 };
  const WARDS = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const w = B.w + c * (B.e - B.w) / 3, e = w + (B.e - B.w) / 3, n = B.n - r * (B.n - B.s) / 3, s = n - (B.n - B.s) / 3;
    WARDS.push({ id: 'W' + (r * 3 + c + 1), bbox: [w, s, e, n], c: [(w + e) / 2, (s + n) / 2] });
  }
  const wardOf = ([x, y]) => (WARDS.find(w => x >= w.bbox[0] && x <= w.bbox[2] && y >= w.bbox[1] && y <= w.bbox[3]) || WARDS[4]).id;
  const pt = (fx, fy) => [round(B.w + fx * (B.e - B.w), 4), round(B.s + fy * (B.n - B.s), 4)];
  const cityPoly = [[[B.w, B.s], [B.e, B.s], [B.e, B.n], [B.w, B.n], [B.w, B.s]]];
  const STEP = 15 * 60e3, N = 96, t0 = Math.floor(now / STEP) * STEP;
  const times = Array.from({ length: N }, (_, i) => t0 - (N - 1 - i) * STEP);
  const series = (base, amp, noise, ph = 0) => times.map((_, i) => round(base + amp * Math.sin(i / N * 2 * Math.PI + ph) + (rnd() - 0.5) * noise, 1));

  // ---- catalogue ----
  const base = (type, id, name, desc, tags) => catalogue.base(type, id, name, desc, tags);
  catalogue.create(base('catalogueItem', 'urn:demo-cat:catalogue', 'Demo City DX catalogue', 'The catalogue of the demo data exchange. Search: /catalogue/v1/search', ['catalogue']), as('officer@mc.demo-city.example'));
  const prov = {};
  for (const [o, dom, what] of [['pcc', 'pcc', 'Air quality'], ['tr', 'transport', 'Public transport'], ['wd', 'wd', 'Storm water drainage'], ['cs', 'cs', 'Citizen grievances'], ['mc', 'mc', 'Municipal services, weather and GIS']]) {
    const email = `officer@${dom}.demo-city.example`;
    prov[o] = { email, id: `urn:demo-cat:provider/${o}` };
    catalogue.create({ ...base('provider', prov[o].id, ORGS.find(x => x[0] === o)[1], what + ' data provider.', ['provider', o]), organizationInfo: P({ email, url: `https://${dom}.demo-city.example` }) }, as(email));
  }
  const rsItem = (id, name, desc, host, org, tags, email) => catalogue.create({ ...base('resourceServer', id, name, desc, tags), resourceServerHTTPAccessURL: P(`https://${host}/resource/v1`), resourceServerOrg: P({ name: org }), coverageRegion: G({ type: 'Polygon', coordinates: cityPoly }) }, as(email));
  rsItem('urn:demo-cat:rs/rs1', 'Resource Server 1 (DX compliant)', 'Hosts sensor streams, tables and files. Validates tokens with the DX authorization server.', 'rs1.mc.demo-city.example', 'Municipal Corporation (demo)', ['resource server'], 'officer@mc.demo-city.example');
  rsItem('urn:demo-cat:rs/rs2', 'Resource Server 2 (legacy, behind DX Adapter)', 'A legacy drainage export that is not DX compliant. The DX Adapter handles tokens and translation.', 'rs2-adapter.wd.demo-city.example', 'Water and Drainage Department (demo)', ['resource server', 'adapter'], 'officer@wd.demo-city.example');
  const GROUPS = {};
  const group = (key, name, p, rs, model, access) => {
    GROUPS[key] = { p, rs, model, access };
    catalogue.create({ ...base('resourceServerGroup', `urn:demo-cat:group/${key}`, name, name + ' sharing one data model and one access object.', ['group', key]), resourceServer: Rl(`urn:demo-cat:rs/${rs}`), refDataModel: Rl(`<catalogue-link>/${model}/${model}_dataModel.json`), provider: Rl(prov[p].id), accessObjectType: P(access) }, as(prov[p].email));
  };
  group('aqm', 'Air quality sensors', 'pcc', 'rs1', 'airQuality', 'openAPI');
  group('itms', 'Bus positions', 'tr', 'rs1', 'busPosition', 'asyncAPI');
  group('stops', 'Bus stops', 'tr', 'rs1', 'busStops', 'openAPI');
  group('drains', 'Storm water drains', 'wd', 'rs2', 'drainLevel', 'openAPI');
  group('weather', 'Weather stations', 'mc', 'rs1', 'weather', 'openAPI');
  group('swm', 'Solid waste', 'mc', 'rs1', 'wasteDaily', 'openAPI');
  group('griev', 'Citizen grievances', 'cs', 'rs1', 'grievance', 'openAPI');
  group('grievview', 'Grievance counts (view)', 'cs', 'rs1', 'grievanceCount', 'openAPI');
  group('camera', 'Traffic cameras', 'tr', 'rs1', 'camera', 'custom');
  group('gis', 'GIS layers', 'mc', 'rs1', 'wardBoundary', 'openAPI');
  group('fare', 'Fare revenue', 'tr', 'rs1', 'fareRevenue', 'openAPI');
  group('floodalert', 'Flood alerts', 'wd', 'rs1', 'floodAlert', 'asyncAPI');

  const items = {};
  const res = ({ key, grp, name, desc, tags, rtype, label, loc, data }) => {
    const g = GROUPS[grp];
    const doc = { ...base('resourceItem', `urn:demo-cat:${grp}/${key}`, name, desc, tags), resourceId: P(key), resourceType: P(rtype), resourceServer: Rl(`urn:demo-cat:rs/${g.rs}`), resourceServerGroup: Rl(`urn:demo-cat:group/${grp}`), provider: Rl(prov[g.p].id), refDataModel: Rl(`<catalogue-link>/${g.model}/${g.model}_dataModel.json`),
      accessInformation: P([{ accessObjectType: g.access, accessObject: Rl(`<catalogue-link>/${grp}_api.json`), accessObjectVariables: P({ resourceId: key }) }]),
      authorizationServerInfo: P({ authServer: `https://${cfg.authHost}`, authType: 'dx-auth' }), accessPolicyLabel: P(label), license: P(label === 'public' ? 'Open data licence (demo)' : 'Provider licence (demo)') };
    if (loc) doc.location = G({ type: 'Point', coordinates: loc });
    items[doc.id] = { officer: as(prov[g.p].email) };
    catalogue.create(doc, as(prov[g.p].email), data);
    return doc.id;
  };
  const ingest = (id, rows, mode) => resource.ingest(items[id].officer, { id, data: rows, mode });

  // air quality
  [[.15, .8], [.5, .85], [.85, .75], [.2, .3], [.55, .45], [.8, .2]].forEach((f, i) => {
    const loc = pt(...f), pm = series([48, 95, 60, 40, 72, 55][i], 18, 10, i), co2 = series([420, 610, 470, 405, 520, 450][i], 40, 20, i), temp = series([31, 34, 32, 30, 33, 31][i], 3, 1, i);
    const id = res({ key: 'aqm-' + (i + 1), grp: 'aqm', name: 'Air quality sensor ' + (i + 1), desc: 'Environmental sensor measuring CO2, temperature and PM2.5 (synthetic values).', tags: ['environment', 'air-quality', 'pollution', 'CO2', 'Temperature', 'PM2.5', wardOf(loc)], rtype: 'messageStream', label: 'public', loc });
    ingest(id, times.map((t, k) => ({ NAME: 'Air quality sensor ' + (i + 1), CO2_MAX: co2[k], TEMPERATURE_MAX: temp[k], PM2_5: Math.max(0, pm[k]), LASTUPDATEDATETIME: iso(t) })));
  });
  // weather
  [[.1, .1], [.9, .1], [.5, .5], [.1, .9], [.9, .9]].forEach((f, i) => {
    const loc = pt(...f), temp = series([30.5, 32, 35.5, 30, 31.2][i], 3, 0.8, 0.3), rh = series(62, 10, 4), ws = series(3 + i * 0.4, 1.2, 0.6), wd = series(220 + i * 8, 20, 10);
    const id = res({ key: 'wx-' + (i + 1), grp: 'weather', name: 'Weather station ' + (i + 1), desc: 'Temperature, humidity, wind and rain (synthetic).', tags: ['weather', 'temperature', 'wind', 'rain', wardOf(loc)], rtype: 'messageStream', label: 'public', loc });
    ingest(id, times.map((t, k) => ({ airTemperature: temp[k], relativeHumidity: Math.min(100, Math.max(0, rh[k])), windSpeed: Math.max(0, ws[k]), windDirection: ((wd[k] % 360) + 360) % 360, rainfall: k > 80 ? round(rnd() * 12, 1) : 0, observationDateTime: iso(t) })));
  });
  // drains (legacy server, protected)
  [[.2, .2], [.5, .15], [.8, .3], [.35, .6], [.7, .7]].forEach((f, i) => {
    const loc = pt(...f), cap = [1.8, 2.2, 1.5, 2.0, 1.6][i], lv = series([0.9, 1.1, 1.2, 0.8, 0.7][i], 0.15, 0.08).map((v, k) => round(v + (k > 80 ? (k - 80) * [0.03, 0.02, 0.028, 0.01, 0.012][i] : 0), 2));
    const id = res({ key: 'drain-' + (i + 1), grp: 'drains', name: 'Drain level sensor ' + (i + 1), desc: 'Storm water drain level and flow (legacy system, synthetic).', tags: ['flood', 'drain', 'storm water', wardOf(loc)], rtype: 'messageStream', label: 'protected', loc });
    ingest(id, times.map((t, k) => ({ level: lv[k], flow: round(lv[k] * 1.9 + rnd() * 0.2, 2), capacity: cap, observationDateTime: iso(t) })));
  });
  // bus stops and buses
  const ROUTES = { 'R-10': [[.05, .5], [.25, .52], [.45, .5], [.65, .48], [.85, .5], [.97, .52]], 'R-21': [[.5, .05], [.48, .28], [.5, .5], [.52, .72], [.5, .95]] };
  const stopsId = res({ key: 'bus-stops', grp: 'stops', name: 'Bus stops (all routes)', desc: 'Stop locations for routes 10 and 21.', tags: ['transport', 'bus', 'stops'], rtype: 'table', label: 'public' });
  ingest(stopsId, Object.entries(ROUTES).flatMap(([r, st]) => st.map((f, i) => ({ stopId: `S${r.slice(2)}-${i + 1}`, routeId: r, name: `Stop ${r.slice(2)}-${i + 1}`, location: { type: 'Point', coordinates: pt(...f) } }))));
  const lerp = (a, b, f) => [round(a[0] + (b[0] - a[0]) * f, 5), round(a[1] + (b[1] - a[1]) * f, 5)];
  [['BUS-101', 'R-10', 1, .4, 18, 2], ['BUS-102', 'R-10', 3, .7, 9, 9], ['BUS-201', 'R-21', 0, .6, 21, 0], ['BUS-202', 'R-21', 2, .3, 7, 6, true]].forEach(([bid, r, seg, f, speed, delay, off]) => {
    const st = ROUTES[r].map(x => pt(...x)); let loc = lerp(st[seg], st[seg + 1], f); if (off) loc = [round(loc[0] + 0.012, 5), loc[1]];
    const id = res({ key: bid.toLowerCase(), grp: 'itms', name: `Bus ${bid} position`, desc: `Position of a bus on route ${r.slice(2)} (synthetic).`, tags: ['transport', 'bus', 'position', r], rtype: 'messageStream', label: 'public', loc });
    ingest(id, times.map((t, k) => ({ busId: bid, routeId: r, location: { type: 'Point', coordinates: loc }, speed: round(Math.max(0, speed + (rnd() - 0.5) * 3)), delayMinutes: Math.max(0, Math.round(delay + (rnd() - 0.5) * 4 + (k < 48 ? -3 : 0))), observationDateTime: iso(t) })));
  });
  // waste (private)
  const DAYS = Array.from({ length: 14 }, (_, i) => new Date(now - (13 - i) * 86400e3).toISOString().slice(0, 10));
  const wasteId = res({ key: 'waste-daily', grp: 'swm', name: 'Daily waste tonnage by ward', desc: 'Tonnes collected per ward per day, last 14 days (synthetic).', tags: ['waste', 'swm', 'tonnage'], rtype: 'table', label: 'private' });
  ingest(wasteId, WARDS.flatMap((w, i) => DAYS.map((d, k) => ({ ward: w.id, date: d, tonnes: round([42, 38, 55, 47, 61, 39, 44, 50, 36][i] + (rnd() - 0.5) * 6 + (i === 4 && k === 13 ? 24 : 0)) }))));
  // grievances (confidential, with made-up personal details) and a count view without them (protected)
  const GCATS = ['Garbage not collected', 'Streetlight not working', 'Water logging', 'Pothole', 'Drain blocked', 'Water supply'];
  const grId = res({ key: 'grievance-records', grp: 'griev', name: 'Grievance records (with citizen details)', desc: 'Complaint records from the grievance aggregator. Contains made-up names and phone numbers.', tags: ['grievance', 'citizen', 'complaints'], rtype: 'table', label: 'confidential' });
  ingest(grId, Array.from({ length: 180 }, (_, i) => { const w = WARDS[Math.floor(rnd() * rnd() * 9)]; return { ref: 'G-' + (5000 + i), ward: w.id, category: GCATS[Math.floor(rnd() * (w.id === 'W3' ? 3 : 6))], date: DAYS[Math.floor(rnd() * 14)], citizenName: 'Citizen ' + (i + 1), phone: '9XXXXXX' + String(100 + i).slice(-3) }; }));
  res({ key: 'grievance-counts', grp: 'grievview', name: 'Grievance counts by ward and category (view)', desc: 'A view over the grievance records with no personal details.', tags: ['grievance', 'citizen', 'view'], rtype: 'table', label: 'protected', data: { kind: 'count', src: grId, attrs: ['ward', 'category'] } });
  // others
  const camId = res({ key: 'cam-junction-5', grp: 'camera', name: 'Traffic camera, Junction 5', desc: 'Junction camera. Live and archived playback of synthetic pictures (no real camera).', tags: ['transport', 'camera', 'video'], rtype: 'mediaStream', label: 'private', loc: pt(.45, .5), data: { kind: 'table' } });
  ingest(camId, [{ streamURL: 'rtsp://camera.transport.demo-city.example/junction-5 (placeholder)', location: { type: 'Point', coordinates: pt(.45, .5) } }]);
  // synthetic camera pictures for playback (BIS 4.5.2.1): one every 5 minutes for the last 2 hours
  for (let k = 24; k >= 0; k--) { const t = Math.floor(now / 300e3) * 300e3 - k * 300e3; resource.mediaPut(items[camId].officer, { id: camId, mime: 'image/svg+xml', data: Buffer.from(cameraFrame('Junction 5', t)).toString('base64'), ts: new Date(t).toISOString() }); }
  const gisId = res({ key: 'ward-boundaries', grp: 'gis', name: 'Ward boundaries', desc: 'Nine synthetic wards as GeoJSON.', tags: ['gis', 'ward', 'boundary'], rtype: 'file', label: 'public' });
  ingest(gisId, WARDS.map(w => ({ wardId: w.id, boundary: { type: 'Polygon', coordinates: [[[w.bbox[0], w.bbox[1]], [w.bbox[2], w.bbox[1]], [w.bbox[2], w.bbox[3]], [w.bbox[0], w.bbox[3]], [w.bbox[0], w.bbox[1]]]] } })));
  const fareId = res({ key: 'fare-revenue', grp: 'fare', name: 'Fare revenue and cost by mode', desc: 'Daily revenue and operating cost for bus and metro (synthetic).', tags: ['transport', 'finance', 'revenue'], rtype: 'table', label: 'protected' });
  ingest(fareId, DAYS.slice(-7).flatMap(d => [{ mode: 'bus', date: d, revenue: Math.round(410000 + rnd() * 30000), cost: Math.round(620000 + rnd() * 20000) }, { mode: 'metro', date: d, revenue: Math.round(900000 + rnd() * 60000), cost: Math.round(1000000 + rnd() * 40000) }]));
  res({ key: 'flood-alerts', grp: 'floodalert', name: 'Flood alert messages', desc: 'Alerts published when a drain crosses its warning level.', tags: ['flood', 'alert'], rtype: 'message', label: 'public' });

  seedTransit({ group, res, ingest, times, rnd, round, provider: 'tr', busRoutes: Object.keys(ROUTES), lineNames: { metro: 'Metro Line 1', suburban: 'Suburban Line S1' },
    metro: [[.1, .62], [.25, .6], [.4, .57], [.55, .55], [.7, .53], [.85, .5]].map((f, i) => [`Metro station ${i + 1}`, pt(...f)]),
    suburban: [[.02, .2], [.3, .25], [.6, .3], [.95, .35]].map((f, i) => [`Rail station ${i + 1}`, pt(...f)]) });
  // State-level and sector-wise reports: the CIL publishes this city's figures here every hour (aggregates only).
  group('perf', 'City performance figures', 'mc', 'rs1', 'cityPerformance', 'openAPI');
  res({ key: 'city-performance', grp: 'perf', name: 'City performance figures', desc: 'Sector-wise figures computed every hour by the City Intelligence Layer for state-level reports (aggregates only, demo data).', tags: ['city-performance', 'performance', 'report', 'state-level'], rtype: 'messageStream', label: 'public' });
  // starting policies: who is already on C
  const addC = (id, emails) => { const it = catalogue.get(id); authz.setPolicy(id, { C: [...it.policy.C, ...emails] }, items[id].officer); };
  addC(wasteId, ['planner@mc.demo-city.example', 'control@mc.demo-city.example', 'cil@mc.demo-city.example']);
  addC('urn:demo-cat:grievview/grievance-counts', ['control@mc.demo-city.example', 'cil@mc.demo-city.example']);
  for (let i = 1; i <= 5; i++) addC(`urn:demo-cat:drains/drain-${i}`, ['control@mc.demo-city.example', 'cil@mc.demo-city.example']);
  addC(fareId, ['control@mc.demo-city.example', 'cil@mc.demo-city.example']); // the control room reads fares for the Figure 7 financial comparison
  addC(camId, ['control@mc.demo-city.example']); // the control room watches the junction camera (BIS-37 playback)
  app.audit.log('Operations', 'seed', 'Demo city seeded', `${catalogue.all().length} catalogue items, synthetic data`);
  return { passwords: pw, certs: Object.fromEntries(Object.entries(certs).map(([e, c]) => [e, c.serial])) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createApp } = await import('./server.js');
  const app = createApp();
  const r = (app.cfg.cityProfile === 'kanpur' ? seedKanpur : seed)(app, { password: process.env.DX_SEED_PASSWORD || undefined, adminPassword: process.env.DX_SEED_ADMIN_PASSWORD || undefined });
  const out = path.join(app.cfg.dataDir, 'initial-passwords.txt');
  fs.writeFileSync(out, 'Initial passwords (change on first login). Keep this file private and delete it after use.\n' + Object.entries(r.passwords).map(([u, p]) => `${u}\t${p}`).join('\n') + '\n', { mode: 0o600 });
  console.log(`Seeded ${app.cfg.cityName} with synthetic demo data. Passwords written to ${out}. Client certificates in ${pkiPaths(app.cfg.pkiDir).clients}.`);
  await app.close();
}
