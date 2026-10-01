// Kanpur profile (DX_CITY_PROFILE=kanpur): the same data exchange and City Intelligence Layer, set up with
// Kanpur's city departments. Department names are real; every reading, record, boundary and position is
// SYNTHETIC demo data (zone boundaries are a simple grid, places are approximate). Not an official system.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q } from './db.js';
import { iso, round } from './util.js';
import { pkiPaths } from './identity/ca.js';

let seedVal = 20261001;
const rnd = () => { seedVal = (seedVal * 1664525 + 1013904223) % 4294967296; return seedVal / 4294967296; };
const P = v => ({ type: 'Property', value: v }), Rl = v => ({ type: 'Relationship', value: v }), G = g => ({ type: 'GeoProperty', value: { geometry: g } });
const D = 'kanpur-demo.example';

// [id, name, what it publishes]
export const DEPARTMENTS = [
  ['knn', 'Kanpur Nagar Nigam (demo)', 'Solid waste, citizen grievances and zone boundaries'],
  ['kjs', 'Kanpur Jal Sansthan (demo)', 'Water supply, drains and pumping stations'],
  ['kesco', 'Kanpur Electricity Supply Company - KESCO (demo)', 'Electricity feeders'],
  ['traffic', 'Kanpur Traffic Police (demo)', 'Junction traffic counts and cameras'],
  ['fire', 'UP Fire and Emergency Services, Kanpur (demo)', 'Fire and rescue calls'],
  ['cmo', 'Chief Medical Officer, Kanpur Nagar (demo)', 'Hospital bed availability'],
  ['kda', 'Kanpur Development Authority (demo)', 'Building permissions'],
  ['pwd', 'Public Works Department, Kanpur (demo)', 'Road works and lane closures'],
  ['uppcb', 'UP Pollution Control Board, Kanpur office (demo)', 'Air quality'],
  ['kctsl', 'Kanpur City Transport (demo)', 'City buses, stops and fares'],
  ['iccc', 'Kanpur Smart City ICCC and disaster control room (demo)', 'Weather and flood alerts; runs the control room'],
];
const OTHERS = [['lab', 'University research lab (demo)', 'lab.example'], ['dev', 'Citizen app developer (demo)', 'apps.example']];
const dom = id => `${id}.${D}`;
// short names for certificate common names (64 characters at most)
const SHORT = { knn: 'Nagar Nigam', kjs: 'Jal Sansthan', kesco: 'KESCO', traffic: 'Traffic Police', fire: 'Fire Service', cmo: 'CMO health', kda: 'KDA', pwd: 'PWD', uppcb: 'UPPCB', kctsl: 'City Transport', iccc: 'ICCC control room' };
const officer = id => `officer@${dom(id)}`, staff = id => `staff@${dom(id)}`;

export function seedKanpur(app, { password, adminPassword, now = Date.now() } = {}) {
  const { db, identity, accounts, catalogue, authz, resource, cfg } = app;
  if (q.get(db, 'SELECT 1 FROM orgs LIMIT 1')) throw new Error('database already seeded');
  seedVal = 20261001;
  const pki = pkiPaths(cfg.pkiDir);
  for (const [id, name] of DEPARTMENTS) identity.registerOrg({ id, name, domain: dom(id), whitelisted: true }, 'seed');
  for (const [id, name, domain] of OTHERS) identity.registerOrg({ id, name, domain, whitelisted: true }, 'seed');
  identity.registerOrg({ id: 'unlisted', name: 'Unlisted Company (demo)', domain: 'unlisted.example', whitelisted: false }, 'seed');

  const HOLDERS = [
    ...DEPARTMENTS.map(([id]) => [`dx@${dom(id)}`, `Kanpur ${SHORT[id]} organisation certificate`, 0, 'org']),
    [`admin@${dom('iccc')}`, `rs1.${dom('iccc')}`, 1, 'rs'],
    [`admin@${dom('kjs')}`, `rs2-adapter.${dom('kjs')}`, 1, 'rs'],
    ...DEPARTMENTS.map(([id]) => [officer(id), `${SHORT[id]} data officer`, 3, 'officer']),
    ...DEPARTMENTS.map(([id]) => [staff(id), `${SHORT[id]} staff`, 4, 'emp']),
    [`control@${dom('iccc')}`, 'ICCC control room operator', 5, 'emp'],
    [cfg.cilServiceEmail, 'City Intelligence Layer service', 5, 'emp'],
    ['analyst@lab.example', 'Research analyst', 2, 'ind'],
    ['dev@apps.example', 'Citizen app developer', 2, 'ind'],
  ];
  const certs = {};
  for (const [email, cn, cls, kind] of HOLDERS) {
    const c = identity.issueDirect({ cn, email, cls, kind });
    certs[email] = identity.certBySerial(c.serial);
    const base = path.join(pki.clients, email.replace(/[^\w.@-]/g, '_'));
    fs.writeFileSync(base + '.crt', c.pem); fs.writeFileSync(base + '.key', c.keyPem, { mode: 0o600 });
  }
  const ACCOUNTS = [
    ['admin', 'admin', null, 'DX administrator'],
    ['auditor', 'auditor', null, 'Auditor (read only)'],
    ...DEPARTMENTS.map(([id]) => [`officer.${id}`, 'provider', officer(id), `${SHORT[id]} data officer`]),
    ...DEPARTMENTS.map(([id]) => [`staff.${id}`, 'consumer', staff(id), `${SHORT[id]} staff`]),
    ['control', 'operator', `control@${dom('iccc')}`, 'ICCC control room operator'],
    ['analyst', 'analytics_provider', 'analyst@lab.example', 'Research analyst'],
    ['developer', 'consumer', 'dev@apps.example', 'Citizen app developer'],
  ];
  const pw = {};
  for (const [u, role, email, dn] of ACCOUNTS) {
    const given = role === 'admin' && adminPassword ? adminPassword : password;
    pw[u] = given || crypto.randomBytes(9).toString('base64url') + '9';
    accounts.create({ username: u, password: pw[u], role, certSerial: email ? certs[email].serial : null, displayName: dn, mustChange: !given }, 'seed');
  }
  const principal = email => { const c = certs[email]; return { via: 'seed', email: c.email, cn: c.cn, cls: c.cls, serial: c.serial, dn: c.dn, kind: c.kind, orgId: c.org_id }; };
  const as = email => ({ ...principal(email), role: 'provider' });

  // ---- geography: six synthetic zones over the Kanpur area (a 3 x 2 grid, not the real zone boundaries) ----
  const B = { w: 80.23, s: 26.39, e: 80.41, n: 26.53 };
  const ZONES = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const w = round(B.w + c * (B.e - B.w) / 3, 4), e = round(w + (B.e - B.w) / 3, 4), n = round(B.n - r * (B.n - B.s) / 2, 4), s = round(n - (B.n - B.s) / 2, 4);
    ZONES.push({ id: 'Zone ' + (r * 3 + c + 1), bbox: [w, s, e, n] });
  }
  const zoneOf = ([x, y]) => (ZONES.find(z => x >= z.bbox[0] && x <= z.bbox[2] && y >= z.bbox[1] && y <= z.bbox[3]) || ZONES[4]).id;
  const cityPoly = [[[B.w, B.s], [B.e, B.s], [B.e, B.n], [B.w, B.n], [B.w, B.s]]];
  // approximate positions of well-known places, for demo markers only
  const PL = { Kalyanpur: [80.268, 26.508], Rawatpur: [80.305, 26.487], SwaroopNagar: [80.322, 26.478], Panki: [80.252, 26.47], GovindNagar: [80.298, 26.442],
    KidwaiNagar: [80.322, 26.428], Naubasta: [80.322, 26.403], Central: [80.352, 26.455], Ghantaghar: [80.348, 26.462], Parade: [80.355, 26.47], Jajmau: [80.398, 26.432],
    Chakeri: [80.39, 26.415], Harjinder: [80.37, 26.4], Fazalganj: [80.3, 26.465], Bithoor: [80.27, 26.525], Gwaltoli: [80.335, 26.49], Kakadeo: [80.29, 26.475] };
  const STEP = 15 * 60e3, N = 96, t0 = Math.floor(now / STEP) * STEP;
  const times = Array.from({ length: N }, (_, i) => t0 - (N - 1 - i) * STEP);
  const series = (base, amp, noise, ph = 0) => times.map((_, i) => round(base + amp * Math.sin(i / N * 2 * Math.PI + ph) + (rnd() - 0.5) * noise, 1));
  const DAYS = Array.from({ length: 14 }, (_, i) => new Date(now - (13 - i) * 86400e3).toISOString().slice(0, 10));
  const geo = c => ({ type: 'Point', coordinates: c });

  // ---- catalogue ----
  const base = (type, id, name, desc, tags) => catalogue.base(type, id, name, desc, tags);
  catalogue.create(base('catalogueItem', 'urn:demo-cat:catalogue', 'Kanpur DX catalogue (demo data)', 'The catalogue of the Kanpur data exchange demo. Search: /catalogue/v1/search', ['catalogue']), as(officer('iccc')));
  const prov = {};
  for (const [id, name, what] of DEPARTMENTS) {
    prov[id] = { email: officer(id), id: `urn:demo-cat:provider/${id}` };
    catalogue.create({ ...base('provider', prov[id].id, name, what + ' (synthetic demo data).', ['provider', id]), organizationInfo: P({ email: officer(id), url: `https://${dom(id)}` }) }, as(officer(id)));
  }
  const rsItem = (id, name, desc, host, org, email) => catalogue.create({ ...base('resourceServer', id, name, desc, ['resource server']), resourceServerHTTPAccessURL: P(`https://${host}/resource/v1`), resourceServerOrg: P({ name: org }), coverageRegion: G({ type: 'Polygon', coordinates: cityPoly }) }, as(email));
  rsItem('urn:demo-cat:rs/rs1', 'ICCC resource server (DX compliant)', 'Hosts sensor streams, tables and files for all departments. Validates tokens with the DX authorization server.', `rs1.${dom('iccc')}`, DEPARTMENTS.find(d => d[0] === 'iccc')[1], officer('iccc'));
  rsItem('urn:demo-cat:rs/rs2', 'Jal Sansthan legacy server (behind DX Adapter)', 'A legacy drainage export that is not DX compliant. The DX Adapter handles tokens and translation.', `rs2-adapter.${dom('kjs')}`, DEPARTMENTS.find(d => d[0] === 'kjs')[1], officer('kjs'));
  const GROUPS = {};
  const group = (key, name, p, rs, model, access) => {
    GROUPS[key] = { p, rs, model, access };
    catalogue.create({ ...base('resourceServerGroup', `urn:demo-cat:group/${key}`, name, name + ' sharing one data model and one access object.', ['group', key]), resourceServer: Rl(`urn:demo-cat:rs/${rs}`), refDataModel: Rl(`<catalogue-link>/${model}/${model}_dataModel.json`), provider: Rl(prov[p].id), accessObjectType: P(access) }, as(prov[p].email));
  };
  // group keys used by the City Intelligence Layer analytics keep their names (aqm, weather, drains, itms, stops, swm, griev, grievview, gis, floodalert)
  group('aqm', 'Air quality sensors', 'uppcb', 'rs1', 'airQuality', 'openAPI');
  group('weather', 'Weather stations', 'iccc', 'rs1', 'weather', 'openAPI');
  group('drains', 'Storm water drains', 'kjs', 'rs2', 'drainLevel', 'openAPI');
  group('pumps', 'Pumping stations', 'kjs', 'rs1', 'pumpStation', 'openAPI');
  group('water', 'Water supply by zone', 'kjs', 'rs1', 'waterSupply', 'openAPI');
  group('feeders', 'Electricity feeders', 'kesco', 'rs1', 'powerFeeder', 'openAPI');
  group('junctions', 'Junction traffic counts', 'traffic', 'rs1', 'trafficJunction', 'openAPI');
  group('camera', 'Traffic cameras', 'traffic', 'rs1', 'camera', 'custom');
  group('firecalls', 'Fire and rescue calls', 'fire', 'rs1', 'fireCall', 'openAPI');
  group('beds', 'Hospital beds', 'cmo', 'rs1', 'hospitalBeds', 'openAPI');
  group('permits', 'Building permissions', 'kda', 'rs1', 'buildingPermit', 'openAPI');
  group('roadworks', 'Road works', 'pwd', 'rs1', 'roadWork', 'openAPI');
  group('outages', 'Power cut notices', 'kesco', 'rs1', 'powerNotice', 'openAPI');
  group('itms', 'Bus positions', 'kctsl', 'rs1', 'busPosition', 'asyncAPI');
  group('stops', 'Bus stops', 'kctsl', 'rs1', 'busStops', 'openAPI');
  group('fare', 'Fare revenue', 'kctsl', 'rs1', 'fareRevenue', 'openAPI');
  group('swm', 'Solid waste', 'knn', 'rs1', 'wasteDaily', 'openAPI');
  group('griev', 'Citizen grievances', 'knn', 'rs1', 'grievance', 'openAPI');
  group('grievview', 'Grievance counts (view)', 'knn', 'rs1', 'grievanceCount', 'openAPI');
  group('gis', 'Zone boundaries', 'knn', 'rs1', 'wardBoundary', 'openAPI');
  group('floodalert', 'Flood alerts', 'iccc', 'rs1', 'floodAlert', 'asyncAPI');

  const items = {};
  const res = ({ key, grp, name, desc, tags, rtype, label, loc, data }) => {
    const g = GROUPS[grp];
    const doc = { ...base('resourceItem', `urn:demo-cat:${grp}/${key}`, name, desc, tags), resourceId: P(key), resourceType: P(rtype), resourceServer: Rl(`urn:demo-cat:rs/${g.rs}`), resourceServerGroup: Rl(`urn:demo-cat:group/${grp}`), provider: Rl(prov[g.p].id), refDataModel: Rl(`<catalogue-link>/${g.model}/${g.model}_dataModel.json`),
      accessInformation: P([{ accessObjectType: g.access, accessObject: Rl(`<catalogue-link>/${grp}_api.json`), accessObjectVariables: P({ resourceId: key }) }]),
      authorizationServerInfo: P({ authServer: `https://${cfg.authHost}`, authType: 'dx-auth' }), accessPolicyLabel: P(label), license: P(label === 'public' ? 'Open data licence (demo)' : 'Department licence (demo)') };
    if (loc) doc.location = G({ type: 'Point', coordinates: loc });
    items[doc.id] = { officer: as(prov[g.p].email) };
    catalogue.create(doc, as(prov[g.p].email), data);
    return doc.id;
  };
  const ingest = (id, rows) => resource.ingest(items[id].officer, { id, data: rows });
  const tagz = loc => [zoneOf(loc)];

  // UPPCB air quality
  [['Kalyanpur', 62], ['Fazalganj', 110], ['Central', 96], ['KidwaiNagar', 78], ['Jajmau', 128], ['Naubasta', 70]].forEach(([pl, pm0], i) => {
    const loc = PL[pl], pm = series(pm0, 18, 10, i), co2 = series(430 + i * 30, 40, 20, i), temp = series(31 + (i % 3), 3, 1, i);
    const id = res({ key: 'aqm-' + (i + 1), grp: 'aqm', name: `Air quality sensor, ${pl} (demo)`, desc: 'CO2, temperature and PM2.5 (synthetic values, approximate location).', tags: ['environment', 'air-quality', 'pollution', 'PM2.5', ...tagz(loc)], rtype: 'messageStream', label: 'public', loc });
    ingest(id, times.map((t, k) => ({ NAME: `AQ ${pl}`, CO2_MAX: co2[k], TEMPERATURE_MAX: temp[k], PM2_5: Math.max(0, pm[k]), LASTUPDATEDATETIME: iso(t) })));
  });
  // ICCC weather
  ['Kalyanpur', 'Central', 'Chakeri', 'Panki', 'Naubasta'].forEach((pl, i) => {
    const loc = PL[pl], temp = series(31 + i * 0.6, 3, 0.8, 0.3), rh = series(64, 10, 4), ws = series(2.5 + i * 0.3, 1.2, 0.6), wd = series(250 + i * 8, 20, 10);
    const id = res({ key: 'wx-' + (i + 1), grp: 'weather', name: `Weather station, ${pl} (demo)`, desc: 'Temperature, humidity, wind and rain (synthetic).', tags: ['weather', 'rain', ...tagz(loc)], rtype: 'messageStream', label: 'public', loc });
    ingest(id, times.map((t, k) => ({ airTemperature: temp[k], relativeHumidity: Math.min(100, Math.max(0, rh[k])), windSpeed: Math.max(0, ws[k]), windDirection: ((wd[k] % 360) + 360) % 360, rainfall: k > 80 ? round(rnd() * 14, 1) : 0, observationDateTime: iso(t) })));
  });
  // Jal Sansthan drains (legacy, protected), pumping stations (protected), water supply (public)
  ['Rawatpur', 'Gwaltoli', 'Central', 'GovindNagar', 'Jajmau'].forEach((pl, i) => {
    const loc = PL[pl], cap = [1.8, 2.2, 1.5, 2.0, 1.6][i], lv = series([0.9, 1.1, 1.2, 0.8, 0.7][i], 0.15, 0.08).map((v, k) => round(v + (k > 80 ? (k - 80) * [0.03, 0.02, 0.028, 0.01, 0.012][i] : 0), 2));
    const id = res({ key: 'drain-' + (i + 1), grp: 'drains', name: `Drain level sensor, ${pl} nala (demo)`, desc: 'Storm water drain level and flow (legacy system, synthetic).', tags: ['flood', 'drain', 'storm water', ...tagz(loc)], rtype: 'messageStream', label: 'protected', loc });
    ingest(id, times.map((t, k) => ({ level: lv[k], flow: round(lv[k] * 1.9 + rnd() * 0.2, 2), capacity: cap, observationDateTime: iso(t) })));
  });
  ['Gwaltoli', 'Jajmau', 'GovindNagar', 'Kalyanpur'].forEach((pl, i) => {
    const loc = PL[pl], total = [6, 8, 4, 5][i], sump = series([2.1, 2.6, 1.8, 1.5][i], 0.4, 0.2);
    const id = res({ key: 'sps-' + (i + 1), grp: 'pumps', name: `Pumping station, ${pl} (demo)`, desc: 'Pumps running, sump level and power supply status (synthetic).', tags: ['sewage', 'pumping station', 'flood', ...tagz(loc)], rtype: 'messageStream', label: 'protected', loc });
    ingest(id, times.map((t, k) => ({ stationId: 'SPS-' + (i + 1), zone: zoneOf(loc), location: geo(loc), pumpsRunning: Math.max(0, total - 1 - (i === 1 && k > 85 ? 3 : 0)), pumpsTotal: total, sumpLevel: Math.max(0, sump[k] + (i === 1 && k > 85 ? (k - 85) * 0.25 : 0)), powerStatus: i === 1 && k > 85 ? 'grid off, diesel backup' : 'grid', observationDateTime: iso(t) })));
  });
  const waterId = res({ key: 'water-supply-daily', grp: 'water', name: 'Water supply hours and pressure by zone', desc: 'Daily supply hours and average pressure per zone, last 14 days (synthetic).', tags: ['water', 'supply'], rtype: 'table', label: 'public' });
  ingest(waterId, ZONES.flatMap((z, i) => DAYS.map(d => ({ zone: z.id, date: d, supplyHours: round(Math.min(24, [6, 5, 7, 4.5, 6, 5.5][i] + (rnd() - 0.5) * 1.5), 1), pressure: round(Math.max(0, [1.4, 1.1, 1.6, 0.9, 1.3, 1.2][i] + (rnd() - 0.5) * 0.3), 2) }))));
  // KESCO feeders (protected)
  [['Panki', 'Panki 220 kV'], ['Jajmau', 'Jajmau 132 kV'], ['Central', 'Parade 33 kV'], ['KidwaiNagar', 'Kidwai Nagar 33 kV'], ['Kalyanpur', 'Kalyanpur 33 kV'], ['Chakeri', 'Chakeri 33 kV']].forEach(([pl, ss], i) => {
    const loc = PL[pl], load = series([18, 22, 12, 9, 11, 8][i], 3, 1.2, i);
    const id = res({ key: 'feeder-' + (i + 1), grp: 'feeders', name: `Feeder ${i + 1}, ${ss} substation (demo)`, desc: 'Feeder load and supply status (synthetic).', tags: ['electricity', 'power', 'feeder', ...tagz(loc)], rtype: 'messageStream', label: 'protected', loc });
    ingest(id, times.map((t, k) => { const off = i === 1 && k > 85; return { feederId: 'F-' + (i + 1), substation: ss, zone: zoneOf(loc), location: geo(loc), loadMW: off ? 0 : Math.max(0, load[k]), status: off ? 'tripped' : 'on', observationDateTime: iso(t) }; }));
  });
  // Traffic Police junction counts (public) and a camera descriptor (private)
  [['Ghantaghar', 'Ghantaghar crossing'], ['Rawatpur', 'Rawatpur crossing'], ['Parade', 'Bada Chauraha'], ['Fazalganj', 'Fazalganj crossing'], ['Naubasta', 'Naubasta crossing']].forEach(([pl, nm], i) => {
    const loc = PL[pl], cnt = series([1400, 1100, 1600, 900, 1000][i], 500, 120, -1.5), spd = series([14, 18, 12, 22, 20][i], 5, 2, 1.5);
    const id = res({ key: 'junction-' + (i + 1), grp: 'junctions', name: `${nm} traffic count (demo)`, desc: 'Vehicles per 15 minutes and average speed (synthetic).', tags: ['traffic', 'junction', 'congestion', ...tagz(loc)], rtype: 'messageStream', label: 'public', loc });
    ingest(id, times.map((t, k) => ({ junctionId: 'J-' + (i + 1), name: nm, location: geo(loc), vehicleCount: Math.max(0, Math.round(cnt[k])), avgSpeed: Math.max(2, spd[k]), observationDateTime: iso(t) })));
  });
  const camId = res({ key: 'cam-ghantaghar', grp: 'camera', name: 'Traffic camera, Ghantaghar (demo)', desc: 'Stream descriptor of a junction camera. No video is hosted in this demo.', tags: ['traffic', 'camera', 'video'], rtype: 'mediaStream', label: 'private', loc: PL.Ghantaghar, data: { kind: 'table' } });
  ingest(camId, [{ streamURL: `rtsp://camera.${dom('traffic')}/ghantaghar (placeholder)`, location: geo(PL.Ghantaghar) }]);
  // Fire calls (protected)
  const FT = ['Building fire', 'Shop fire', 'Vehicle fire', 'Rescue', 'Factory fire', 'Electrical short circuit'];
  const fireId = res({ key: 'fire-calls', grp: 'firecalls', name: 'Fire and rescue calls, last 14 days', desc: 'Calls received by the fire control room with response time (synthetic).', tags: ['fire', 'rescue', 'emergency'], rtype: 'table', label: 'protected' });
  const plk = Object.keys(PL);
  ingest(fireId, Array.from({ length: 40 }, (_, i) => { const loc = PL[plk[Math.floor(rnd() * plk.length)]]; const t = now - Math.floor(rnd() * 14 * 86400e3); return { callId: 'FC-' + (2600 + i), zone: zoneOf(loc), type: FT[Math.floor(rnd() * FT.length)], location: geo(loc), reportedAt: iso(t), status: now - t < 3 * 3600e3 ? 'in progress' : 'closed', responseMinutes: round(6 + rnd() * 20) }; }).sort((a, b) => a.reportedAt.localeCompare(b.reportedAt)));
  // CMO hospital beds (public)
  [['Central', 'District hospital (demo)'], ['Rawatpur', 'Medical college hospital (demo)'], ['Kalyanpur', 'Community health centre, Kalyanpur (demo)'], ['Chakeri', 'Community health centre, Chakeri (demo)']].forEach(([pl, nm], i) => {
    const loc = PL[pl], total = [450, 1200, 60, 50][i], free = series([60, 140, 12, 9][i], 15, 6, i);
    const id = res({ key: 'beds-' + (i + 1), grp: 'beds', name: `Beds, ${nm}`, desc: 'Total, free and free ICU beds (synthetic).', tags: ['health', 'hospital', 'beds', ...tagz(loc)], rtype: 'messageStream', label: 'public', loc });
    ingest(id, times.map((t, k) => ({ hospitalId: 'H-' + (i + 1), name: nm, location: geo(loc), bedsTotal: total, bedsFree: Math.max(0, Math.round(free[k])), icuFree: Math.max(0, Math.round([8, 20, 0, 0][i] + (rnd() - 0.5) * 4)), observationDateTime: iso(t) })));
  });
  // KDA building permissions (public) and PWD road works (public)
  const permitId = res({ key: 'building-permits', grp: 'permits', name: 'Building permission applications', desc: 'Applications of the last 14 days with status (synthetic).', tags: ['building', 'permission', 'planning'], rtype: 'table', label: 'public' });
  ingest(permitId, Array.from({ length: 30 }, (_, i) => ({ permitId: 'KDA-BP-' + (8100 + i), zone: ZONES[Math.floor(rnd() * 6)].id, use: ['Residential', 'Commercial', 'Mixed use', 'Institutional'][Math.floor(rnd() * 4)], floors: 1 + Math.floor(rnd() * 6), status: ['Received', 'Under scrutiny', 'Approved', 'Returned'][Math.floor(rnd() * 4)], date: DAYS[Math.floor(rnd() * 14)] })));
  const roadId = res({ key: 'road-works', grp: 'roadworks', name: 'Road works and lane closures', desc: 'Current and planned works (synthetic).', tags: ['roads', 'works', 'traffic'], rtype: 'table', label: 'public' });
  ingest(roadId, [['GT Road near Rawatpur', 'Zone 2', 'In progress', 1], ['VIP Road', 'Zone 3', 'Planned', 1], ['Kalpi Road', 'Zone 4', 'In progress', 2], ['Jajmau bridge approach', 'Zone 6', 'Completed', 0], ['Mall Road', 'Zone 5', 'Planned', 1]].map(([road, zone, status, lanes], i) => ({ workId: 'PWD-' + (310 + i), road: road + ' (demo)', zone, status, lanesClosed: lanes, startDate: DAYS[2 + i * 2], endDate: DAYS[Math.min(13, 6 + i * 2)] })));
  // KESCO power cut notices (public): planned shutdowns and the Jajmau feeder trip shown in the feeder data
  const hr = h => iso(Math.floor(now / 3600e3) * 3600e3 + h * 3600e3);
  const outId = res({ key: 'power-cut-notices', grp: 'outages', name: 'Power cut notices', desc: 'Planned shutdowns and current unplanned cuts by area (synthetic).', tags: ['power', 'electricity', 'outage', 'notice'], rtype: 'table', label: 'public' });
  ingest(outId, [
    ['KESCO-N-501', 'Jajmau and Chakeri (feeder 2)', 'Zone 6', 'Unplanned', -2, 3, 'Feeder tripped; repair team on site', 'Restoration in progress'],
    ['KESCO-N-502', 'Swaroop Nagar', 'Zone 2', 'Planned', 14, 18, 'Line maintenance', 'Scheduled'],
    ['KESCO-N-503', 'Govind Nagar', 'Zone 5', 'Planned', 38, 41, 'Transformer replacement', 'Scheduled'],
    ['KESCO-N-500', 'Kalyanpur', 'Zone 1', 'Unplanned', -20, -17, 'Cable fault', 'Restored'],
  ].map(([noticeId, area, zone, type, a, b, reason, status]) => ({ noticeId, area: area + ' (demo)', zone, type, from: hr(a), to: hr(b), reason, status })));
  // KCTSL buses
  const ROUTES = { 'R-1': ['Kalyanpur', 'Rawatpur', 'SwaroopNagar', 'Parade', 'Central', 'Jajmau'], 'R-7': ['Panki', 'Kakadeo', 'GovindNagar', 'KidwaiNagar', 'Naubasta'] };
  const stopsId = res({ key: 'bus-stops', grp: 'stops', name: 'City bus stops (demo routes 1 and 7)', desc: 'Stop locations for two demo routes.', tags: ['transport', 'bus', 'stops'], rtype: 'table', label: 'public' });
  ingest(stopsId, Object.entries(ROUTES).flatMap(([r, st]) => st.map((pl, i) => ({ stopId: `S${r.slice(2)}-${i + 1}`, routeId: r, name: pl.replace(/([a-z])([A-Z])/g, '$1 $2'), location: geo(PL[pl]) }))));
  const lerp = (a, b, f) => [round(a[0] + (b[0] - a[0]) * f, 5), round(a[1] + (b[1] - a[1]) * f, 5)];
  [['BUS-101', 'R-1', 1, .4, 18, 2], ['BUS-102', 'R-1', 3, .7, 9, 9], ['BUS-701', 'R-7', 0, .6, 21, 0], ['BUS-702', 'R-7', 2, .3, 7, 6, true]].forEach(([bid, r, seg, f, speed, delay, off]) => {
    const st = ROUTES[r].map(pl => PL[pl]); let loc = lerp(st[seg], st[seg + 1], f); if (off) loc = [round(loc[0] + 0.012, 5), loc[1]];
    const id = res({ key: bid.toLowerCase(), grp: 'itms', name: `Bus ${bid} position (demo)`, desc: `Position of a city bus on route ${r.slice(2)} (synthetic).`, tags: ['transport', 'bus', 'position', r], rtype: 'messageStream', label: 'public', loc });
    ingest(id, times.map((t, k) => ({ busId: bid, routeId: r, location: geo(loc), speed: round(Math.max(0, speed + (rnd() - 0.5) * 3)), delayMinutes: Math.max(0, Math.round(delay + (rnd() - 0.5) * 4 + (k < 48 ? -3 : 0))), observationDateTime: iso(t) })));
  });
  const fareId = res({ key: 'fare-revenue', grp: 'fare', name: 'City bus fare revenue and cost', desc: 'Daily revenue and operating cost (synthetic).', tags: ['transport', 'finance', 'revenue'], rtype: 'table', label: 'protected' });
  ingest(fareId, DAYS.slice(-7).map(d => ({ mode: 'bus', date: d, revenue: Math.round(380000 + rnd() * 30000), cost: Math.round(590000 + rnd() * 20000) })));
  // Nagar Nigam: waste (private), grievances (confidential) + count view (protected), zone boundaries (public)
  const wasteId = res({ key: 'waste-daily', grp: 'swm', name: 'Daily waste tonnage by zone', desc: 'Tonnes collected per zone per day, last 14 days (synthetic).', tags: ['waste', 'swm', 'tonnage'], rtype: 'table', label: 'private' });
  ingest(wasteId, ZONES.flatMap((z, i) => DAYS.map((d, k) => ({ ward: z.id, date: d, tonnes: round([210, 260, 190, 240, 280, 170][i] + (rnd() - 0.5) * 20 + (i === 4 && k === 13 ? 80 : 0)) }))));
  const GCATS = ['Garbage not collected', 'Streetlight not working', 'Water logging', 'Pothole', 'Drain blocked', 'Water supply'];
  const grId = res({ key: 'grievance-records', grp: 'griev', name: 'Grievance records (with citizen details)', desc: 'Complaint records. Contains made-up names and phone numbers.', tags: ['grievance', 'citizen', 'complaints'], rtype: 'table', label: 'confidential' });
  ingest(grId, Array.from({ length: 180 }, (_, i) => { const z = ZONES[Math.floor(rnd() * rnd() * 6)]; return { ref: 'KNN-G-' + (5000 + i), ward: z.id, category: GCATS[Math.floor(rnd() * (z.id === 'Zone 3' ? 3 : 6))], date: DAYS[Math.floor(rnd() * 14)], citizenName: 'Citizen ' + (i + 1), phone: '9XXXXXX' + String(100 + i).slice(-3) }; }));
  res({ key: 'grievance-counts', grp: 'grievview', name: 'Grievance counts by zone and category (view)', desc: 'A view over the grievance records with no personal details.', tags: ['grievance', 'citizen', 'view'], rtype: 'table', label: 'protected', data: { kind: 'count', src: grId, attrs: ['ward', 'category'] } });
  const gisId = res({ key: 'zone-boundaries', grp: 'gis', name: 'Zone boundaries (synthetic grid)', desc: 'Six demo zones as GeoJSON. A simple grid, NOT the official zone boundaries.', tags: ['gis', 'zone', 'boundary'], rtype: 'file', label: 'public' });
  ingest(gisId, ZONES.map(z => ({ wardId: z.id, boundary: { type: 'Polygon', coordinates: [[[z.bbox[0], z.bbox[1]], [z.bbox[2], z.bbox[1]], [z.bbox[2], z.bbox[3]], [z.bbox[0], z.bbox[3]], [z.bbox[0], z.bbox[1]]]] } })));
  res({ key: 'flood-alerts', grp: 'floodalert', name: 'Flood alert messages', desc: 'Alerts published by the control room when a drain crosses its warning level.', tags: ['flood', 'alert'], rtype: 'message', label: 'public' });

  // ---- starting policies: who already has access (C), and one open request to show the consent flow ----
  const addC = (id, emails) => { const it = catalogue.get(id); authz.setPolicy(id, { C: [...it.policy.C, ...emails] }, items[id].officer); };
  const ctl = [`control@${dom('iccc')}`, cfg.cilServiceEmail];
  addC(wasteId, [...ctl, staff('knn')]);
  addC('urn:demo-cat:grievview/grievance-counts', [...ctl, staff('knn'), staff('kjs')]);
  for (let i = 1; i <= 5; i++) addC(`urn:demo-cat:drains/drain-${i}`, [...ctl, staff('kjs'), staff('knn')]);
  for (let i = 1; i <= 4; i++) addC(`urn:demo-cat:pumps/sps-${i}`, [...ctl, staff('kjs')]);
  for (let i = 1; i <= 6; i++) addC(`urn:demo-cat:feeders/feeder-${i}`, [...ctl, staff('kesco'), staff('kjs')]);
  addC(fireId, [...ctl, staff('fire'), staff('cmo')]);
  addC(fareId, [...ctl, staff('kctsl')]);
  addC(camId, [`control@${dom('iccc')}`, staff('traffic')]);
  try { authz.requestToken({ ...principal(staff('fire')), role: 'consumer' }, [{ id: 'urn:demo-cat:pumps/sps-2' }], 'Fire service: check pumping station status during water logging'); } catch { /* expected: creates a pending consent request for Jal Sansthan to decide */ }
  app.audit.log('Operations', 'seed', 'Kanpur profile seeded', `${DEPARTMENTS.length} departments, ${catalogue.all().length} catalogue items, synthetic data`);
  return { passwords: pw, certs: Object.fromEntries(Object.entries(certs).map(([e, c]) => [e, c.serial])) };
}
