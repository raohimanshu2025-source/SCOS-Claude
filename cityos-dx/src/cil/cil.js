// City Intelligence Layer (City OS Sections 3-4, Figures 9-13): domain APIs over data exchange data,
// pluggable analytics with the agreed ontology, scheduler, rule-based alerts, OLAP, natural-language
// questions, monthly reports and federation between cities.
import https from 'node:https';
import fs from 'node:fs';
import { q } from '../db.js';
import { iso, round, fail, need, str } from '../util.js';
import { ONT, checkSpec, checkBehaviour } from './ontology.js';
import { BUILTINS, GENERIC, PLUG_OPS, runPlugged, wardOf } from './analytics.js';
import { MODELS, modelOfRef } from '../dx/model.js';
import { actorOf } from '../identity/identity.js';

export function makeCil(db, cfg, audit, catalogue, authz, resource, identity) {
  const state = { up: true, timer: null };
  const groupId = key => `urn:demo-cat:group/${key}`;
  const itemsOfGroup = key => catalogue.all('resourceItem').filter(i => i.doc.resourceServerGroup?.value === groupId(key));

  for (const a of BUILTINS) q.run(db, 'INSERT OR IGNORE INTO analytics (id, spec, builtin, created_at) VALUES (?,?,1,?)', a.id, JSON.stringify({ path: a.path }), iso(Date.now()));

  function plugged() { return q.all(db, 'SELECT * FROM analytics WHERE builtin=0').map(r => ({ ...JSON.parse(r.spec), id: r.id, plugged: true, runs: r.runs, lastRun: r.last_run })); }
  function list() {
    const stats = Object.fromEntries(q.all(db, 'SELECT id, runs, last_run FROM analytics').map(r => [r.id, r]));
    // the provider shown is the department that publishes the analytic's main input group in this city's catalogue
    const providerOf = a => { try { const g = catalogue.get(groupId(a.inputs[0].group)); return catalogue.get(g.doc.provider.value).doc.name.value; } catch { return a.provider; } };
    const BUILTIN_BEHAVIOUR = { trigger: 'schedule', onMissingInput: 'skip', minInputs: 1 };
    return [...BUILTINS.map(a => ({ ...a, repository: 'domain', behaviour: BUILTIN_BEHAVIOUR, provider: providerOf(a), runs: stats[a.id]?.runs ?? 0, lastRun: stats[a.id]?.last_run ?? null })),
      ...plugged().map(a => ({ repository: 'domain', behaviour: BUILTIN_BEHAVIOUR, ...a }))];
  }
  const byPath = path => list().find(a => a.path === path);

  // Reads the inputs through the data exchange; `groups` limits what is loaded.
  function snapshot(groups) {
    const g = new Set([...groups, 'gis']);
    const rows = it => resource.rowsOf(it);
    const locOf = it => it.doc.location?.value?.geometry?.coordinates;
    const wards = [];
    for (const it of itemsOfGroup('gis')) for (const r of rows(it)) {
      const ring = r.boundary.coordinates[0]; const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
      const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      wards.push({ id: r.wardId, bbox, c: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] });
    }
    wards.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    const bbox = wards.length ? [Math.min(...wards.map(w => w.bbox[0])), Math.min(...wards.map(w => w.bbox[1])), Math.max(...wards.map(w => w.bbox[2])), Math.max(...wards.map(w => w.bbox[3]))] : [0, 0, 1, 1];
    const sensors = key => g.has(key) ? itemsOfGroup(key).map(it => ({ id: it.id, key: it.doc.resourceId.value, loc: locOf(it), rows: rows(it) })) : [];
    const s = { city: cfg.cityName, now: Date.now(), wards, bbox, aq: sensors('aqm'), wx: sensors('weather'), drains: sensors('drains'), buses: [], routes: {}, waste: [], grievCounts: [] };
    if (g.has('itms') || g.has('stops')) {
      for (const it of itemsOfGroup('stops')) for (const r of rows(it)) (s.routes[r.routeId] ||= { stops: [] }).stops.push({ stopId: r.stopId, name: r.name, loc: r.location.coordinates });
      for (const r of Object.values(s.routes)) r.stops.sort((a, b) => a.stopId.localeCompare(b.stopId, 'en', { numeric: true }));
      for (const it of itemsOfGroup('itms')) { const h = rows(it); const l = h.at(-1); if (l) s.buses.push({ busId: l.busId, routeId: l.routeId, loc: l.location.coordinates, speed: l.speed, delay: l.delayMinutes, history: h }); }
    }
    if (g.has('railtt')) s.timetable = itemsOfGroup('railtt').flatMap(it => rows(it));
    if (g.has('occupancy')) s.occupancy = itemsOfGroup('occupancy').map(it => ({ id: it.id, rows: rows(it) }));
    if (g.has('fare')) s.fares = itemsOfGroup('fare').flatMap(it => rows(it));
    if (g.has('floodalert')) s.floodAlerts = itemsOfGroup('floodalert').flatMap(it => rows(it));
    if (g.has('swm')) for (const it of itemsOfGroup('swm')) s.waste.push(...rows(it));
    if (g.has('grievview')) for (const it of itemsOfGroup('grievview')) s.grievCounts.push(...rows(it));
    return s;
  }

  // The caller needs a data exchange token for every non-public input (COS-25: CIL reads DX data under DX rules).
  function checkInputs(p, a) {
    const ids = [...new Set(a.inputs.map(i => i.group))].flatMap(k => itemsOfGroup(k)).filter(it => it.policy.label !== 'public').map(it => it.id);
    if (!ids.length) return [];
    if (!p.email) fail(401, `this API uses protected data (${[...new Set(a.inputs.map(i => i.group))].join(', ')}); identify yourself with a certificate or ID token`);
    authz.requestToken(p, ids.map(id => ({ id })), `CIL API ${a.path}`);
    return ids;
  }

  function raise(domain, alerts, source) {
    for (const x of alerts || []) {
      const dup = q.get(db, 'SELECT 1 FROM alerts WHERE msg=? AND ts > ?', x.msg, iso(Date.now() - 60e3));
      if (!dup) q.run(db, 'INSERT INTO alerts (domain, ward, msg, source, ts) VALUES (?,?,?,?,?)', domain, x.ward, x.msg, source, iso(Date.now()));
    }
  }

  function execute(a, body, s) { return a.plugged ? runPlugged(a, s, body) : a.run(s, body); }

  const api = {
    state,
    list,
    ontology: () => ONT,
    setUp(up, by) { state.up = !!up; audit.log('Operations', by, up ? 'CIL resumed' : 'CIL paused', ''); },

    call(p, path, body = {}, { format } = {}) {
      const t0 = Date.now();
      const a = byPath(path); need(a, 404, 'no CIL API at ' + path);
      const rec = ok => q.run(db, 'INSERT INTO api_calls (ts, service, route, status, ms) VALUES (?,?,?,?,?)', iso(Date.now()), 'CIL', path, ok, Date.now() - t0);
      if (!state.up) { rec(503); fail(503, 'City Intelligence Layer APIs are unavailable; retry later'); }
      let used;
      try { used = checkInputs(p, a); } catch (e) { rec(e.status || 500); audit.log('CIL', actorOf(p), `POST ${path} refused`, e.message, false); throw e; }
      const s = snapshot(a.inputs.map(i => i.group));
      const b = { ...(a.plugged ? {} : a.defaults(s)), ...(body && typeof body === 'object' ? body : {}) };
      let r;
      try { r = execute(a, b, s); } catch (e) { rec(400); audit.log('CIL', actorOf(p), `POST ${path} bad request`, e.message, false); fail(400, e.message); }
      raise(a.domain, r.alerts, a.id);
      q.run(db, 'UPDATE analytics SET runs=runs+1, last_run=? WHERE id=?', iso(Date.now()), a.id);
      rec(200);
      audit.log('CIL', actorOf(p), `POST ${path}`, `inputs: ${[...new Set(a.inputs.map(i => groupId(i.group)))].join(', ')}${used.length ? ' (with DX token)' : ''}`);
      const out = { api: path, analytic: a.id, city: cfg.cityName, computedAt: iso(Date.now()), request: b, output: r.output, alertsRaised: (r.alerts || []).length };
      return format === 'ngsi-ld' ? ngsiLd(a, out) : out;
    },

    openapi(a) {
      const props = Object.fromEntries(Object.entries(a.params || (a.plugged ? { threshold: 'number' } : {})).map(([k, t]) => [k, t.startsWith('array') ? { type: 'array', items: { type: 'number' }, description: t } : t === 'date-time' ? { type: 'string', format: 'date-time' } : { type: t === 'number' ? 'number' : 'string' }]));
      const schema = a.out.replace(/\s/g, '');
      return {
        openapi: '3.0.3',
        info: { title: a.name, version: '1.0.0', description: a.procedure, 'x-ontology': { inputs: a.inputs.map(i => ({ [i.role]: groupId(i.group), ingressType: i.type, attribute: i.attr })), RequiresDataPeriodicity: a.dataPeriodicity, ProcessPeriodicity: a.period + ' min', OutputDataType: a.out, visualisation: a.viz, provenance: a.provenance, provider: a.provider } },
        servers: [{ url: cfg.uacUrl }],
        paths: { [a.path]: { post: { summary: a.name, requestBody: { content: { 'application/json': { schema: { type: 'object', properties: props } } } },
          responses: { 200: { description: a.out, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } }, 400: { description: 'Bad request' }, 401: { description: 'Identity needed for a protected input' }, 403: { description: 'No data exchange token for a protected input; consent requested' } } } } },
        components: { schemas: { [schema]: { type: 'object', description: 'Ontology egress type ' + a.out } } },
      };
    },

    // Pluggable analytics (COS-28, COS-33): the provider gives the full Figure 13 specification;
    // schema matching checks each input against the catalogue's data models before the analytic is accepted.
    register(p, spec) {
      need(['analytics_provider', 'provider', 'admin'].includes(p.role) || p.cls === 3, 403, 'analytics providers and data officers only');
      const s = { id: str(spec.id, 40), domain: spec.domain, name: str(spec.name, 120), path: str(spec.path, 80), provider: str(spec.provider, 120) || actorOf(p), inputs: spec.inputs,
        out: spec.out, viz: spec.viz, period: Number(spec.period), dataPeriodicity: str(spec.dataPeriodicity, 40), procedure: str(spec.procedure, 500), provenance: str(spec.provenance, 300),
        operation: spec.operation, threshold: spec.threshold != null ? Number(spec.threshold) : undefined, alertAbove: spec.alertAbove != null ? Number(spec.alertAbove) : undefined,
        repository: 'domain', template: spec.template ? str(spec.template, 60) : undefined };
      const errs = checkSpec(s);
      const [bh, bhErrs] = checkBehaviour(spec.behaviour ?? {}); s.behaviour = bh; errs.push(...bhErrs);
      need(/^[a-z0-9-]{3,40}$/.test(s.id), 400, 'id must be 3-40 lowercase letters, digits or -');
      if (!PLUG_OPS[s.operation]) errs.push('operation must be one of ' + Object.keys(PLUG_OPS).join(', '));
      for (const i of s.inputs || []) {
        const items = itemsOfGroup(i.group);
        if (!items.length) { errs.push(`input group "${i.group}" has no items in the catalogue`); continue; }
        const model = modelOfRef(items[0].doc.refDataModel.value);
        if (!MODELS[model]?.props[i.attr] && !(i.attr === 'location' && items[0].doc.location)) errs.push(`schema matching: attribute "${i.attr}" is not in data model ${model}`);
      }
      if (byPath(s.path)) errs.push('an API already uses ' + s.path);
      if (q.get(db, 'SELECT 1 FROM analytics WHERE id=?', s.id)) errs.push('an analytic already uses id ' + s.id);
      if (errs.length) { audit.log('CIL', actorOf(p), 'Analytic refused', errs[0], false); fail(400, 'analytic specification refused', { errors: errs }); }
      q.run(db, 'INSERT INTO analytics (id, spec, builtin, created_at) VALUES (?,?,0,?)', s.id, JSON.stringify({ ...s, owner: actorOf(p) }), iso(Date.now()));
      audit.log('CIL', actorOf(p), s.behaviour.trigger === 'schedule' ? 'Analytic registered and scheduled' : 'Analytic registered (runs on request)', `${s.id} ${s.path}${s.behaviour.trigger === 'schedule' ? ` every ${s.period} min` : ''}${s.template ? ` from generic ${s.template}` : ''}`);
      return byPath(s.path);
    },

    // Analytics repository (City OS Figure 13): domain-specific analytics (bound to a domain's data) and generic
    // procedures, searchable by repository, domain, ingress or egress type and words.
    templates: () => GENERIC.map(g => ({ ...g, repository: 'generic' })),
    search({ repository, domain, ingress, egress, q: words } = {}) {
      const dom = list().map(a => ({ id: a.id, repository: 'domain', name: a.name, domain: a.domain, path: a.path, ingress: [...new Set(a.inputs.map(i => i.type))], out: a.out, viz: [a.viz], procedure: a.procedure, provider: a.provider, behaviour: a.behaviour, template: a.template }));
      const gen = api.templates().map(g => ({ id: g.id, repository: 'generic', name: g.name, domain: null, path: null, ingress: g.ingress, out: g.out, viz: g.viz, procedure: g.procedure, provider: g.provenance }));
      const w = String(words || '').toLowerCase().split(/\s+/).filter(Boolean);
      return [...dom, ...gen].filter(a => (!repository || a.repository === repository) && (!domain || a.domain === domain) && (!ingress || a.ingress.includes(ingress)) && (!egress || a.out === egress)
        && w.every(x => `${a.name} ${a.procedure} ${a.domain || ''} ${a.path || ''}`.toLowerCase().includes(x)));
    },
    // Customisation service (Figure 13): binds a generic procedure to a domain's data after schema matching, with its
    // own visualisation and behaviour. The result is registered as a domain-specific analytic.
    customize(p, b = {}) {
      const g = GENERIC.find(x => x.id === b.template); need(g, 404, 'no generic analytic ' + b.template + '; see /cil/v1/analytics/search?repository=generic');
      const inputs = (Array.isArray(b.inputs) ? b.inputs : []).map(i => ({ group: i.group, attr: i.attr, type: i.type || g.ingress[0], role: i.role || 'RequiresDataSource' }));
      const errs = inputs.filter(i => !g.ingress.includes(i.type)).map(i => `input type "${i.type}" does not fit ${g.name} (needs ${g.ingress.join(' or ')})`);
      const viz = b.viz || g.viz[0]; if (!g.viz.includes(viz)) errs.push(`visualisation "${viz}" does not fit ${g.name} (allowed: ${g.viz.join(', ')})`);
      if (errs.length) { audit.log('CIL', actorOf(p), 'Analytic refused', errs[0], false); fail(400, 'customisation refused', { errors: errs }); }
      return api.register(p, { ...b, inputs, viz, out: g.out, operation: g.operation, template: g.id,
        procedure: `${g.procedure} (generic ${g.id}, customised for ${b.domain || 'a domain'})`, provenance: b.provenance || g.provenance });
    },
    unregister(p, id) {
      const r = q.get(db, 'SELECT * FROM analytics WHERE id=? AND builtin=0', id); need(r, 404, 'no such plugged analytic');
      need(JSON.parse(r.spec).owner === actorOf(p) || p.role === 'admin', 403, 'only the analytic owner or an administrator');
      q.run(db, 'DELETE FROM analytics WHERE id=?', id); audit.log('CIL', actorOf(p), 'Analytic removed', id);
    },

    // Periodic execution (COS-28): each analytic runs every `period` minutes under the CIL service identity.
    tick(now = Date.now()) {
      if (!state.up) return 0;
      const svc = serviceSelf(); if (!svc) return 0; let n = 0;
      for (const a of list()) {
        if (a.behaviour?.trigger === 'onRequest') continue;
        const due = !a.lastRun || now - Date.parse(a.lastRun) >= a.period * cfg.schedulerMinuteMs;
        if (!due) continue;
        try { api.call(svc, a.path, {}); n++; } catch (e) { q.run(db, 'UPDATE analytics SET last_run=? WHERE id=?', iso(now), a.id); }
      }
      return n;
    },
    start() { if (cfg.schedulerEnabled && !state.timer) { state.timer = setInterval(() => api.tick(), Math.max(1000, Math.min(cfg.schedulerMinuteMs, 60000))); state.timer.unref(); } },
    stop() { clearInterval(state.timer); state.timer = null; },

    alerts: (limit = 100) => q.all(db, 'SELECT * FROM alerts ORDER BY id DESC LIMIT ?', Math.min(500, Number(limit) || 100)),

    // OLAP access (City OS Section 4): pivot of a measure over two dimensions.
    olap(p, { measure = 'griev', rows = 'ward', cols = 'cat' }) {
      const dims = ['ward', 'day', 'cat']; need(dims.includes(rows) && dims.includes(cols) && rows !== cols, 400, 'rows and cols must be two of ward, day, cat');
      let facts;
      if (measure === 'griev') { const a = { inputs: [{ group: 'grievview' }] }; checkInputs(p, a); facts = snapshot(['grievview']).grievCounts.map(g => ({ ward: g.ward, cat: g.category, day: 'all', v: g.count })); }
      else if (measure === 'waste') { checkInputs(p, { inputs: [{ group: 'swm' }] }); facts = snapshot(['swm']).waste.map(w => ({ ward: w.ward, day: w.date, cat: 'waste', v: w.tonnes })); }
      else if (measure === 'alerts') facts = q.all(db, 'SELECT * FROM alerts').map(x => ({ ward: x.ward, day: x.ts.slice(0, 10), cat: x.domain, v: 1 }));
      else fail(400, 'measure must be griev, waste or alerts');
      const R = [...new Set(facts.map(f => f[rows]))].sort(), C = [...new Set(facts.map(f => f[cols]))].sort();
      const cell = (r, c) => round(facts.filter(f => f[rows] === r && f[cols] === c).reduce((a, f) => a + f.v, 0));
      audit.log('CIL', actorOf(p), 'OLAP query', `${measure} by ${rows} x ${cols}`);
      return { measure, rows: R, cols: C, cells: R.map(r => C.map(c => cell(r, c))) };
    },

    // Natural language questions (City OS Section 4): keyword matching onto the CIL APIs. Not a language model.
    ask(p, question) {
      const qn = str(question).toLowerCase(); need(qn, 400, 'question required');
      const ward = (qn.match(/ward\s*(\d+)/) || [])[1];
      const route = (qn.match(/route\s*(\d+)/) || [])[1];
      const has = (...w) => w.some(x => qn.includes(x));
      let path, body = {}, say;
      if (has('grievance', 'complaint')) { if (ward) { path = '/grievance/wardTop'; body = { ward: 'W' + ward, top: 1 }; say = o => o.rows[0] ? `The top grievance in ward ${ward} is "${o.rows[0].category}" (${o.rows[0].count}).` : `No grievances found in ward ${ward}.`; } else { path = '/grievance/top'; say = o => `Top grievance city-wide: "${o.rows[0].category}" (${o.rows[0].count}).`; } }
      else if (has('drain', 'overflow', 'flood')) { path = '/flood/alerts'; say = o => o.rows.length ? `${o.rows.length} drain(s) at or above 75% of capacity: ${o.rows.map(r => `${r.drain.split('/').pop()} ${r.percentOfCapacity}% (${r.severity}, ${r.ward})`).join('; ')}.` : 'No drain is near overflow.'; }
      else if (has('bus', 'eta', 'arrive')) { const r = 'R-' + (route || '10'); path = '/publictransit/eta'; const s = snapshot(['stops']); body = { routeid: r, currentlocation: s.routes[r]?.stops.at(-2)?.loc }; say = o => o.value != null ? `Next bus at ${o.stop} on ${r}: about ${o.value} minutes (${o.bus}).` : `No bus is approaching that stop on ${r}.`; }
      else if (has('air', 'pm2', 'pollution')) { path = '/environment/spatialForecast'; say = o => { const w = o.sensors.slice().sort((a, b) => b.meanPM2_5 - a.meanPM2_5)[0]; return `The air is worst near ${w.id.split('/').pop()} (mean PM2.5 ${w.meanPM2_5} ug/m3 over the last 2 hours).`; }; }
      else if (has('waste', 'garbage', 'tonne')) { path = '/swm/dailyEstimate'; say = o => { const r = ward ? o.rows.find(x => x.ward === 'W' + ward) : o.rows.slice().sort((a, b) => b.estimateTonnes - a.estimateTonnes)[0]; return r ? `Estimated waste tomorrow in ${r.ward}: ${r.estimateTonnes} t.` : 'No estimate for that ward.'; }; }
      else if (has('temperature', 'hot', 'heat', 'weather')) { path = '/weather/interpolation'; say = o => `Temperatures across the city range from ${o.min} to ${o.max} degree Celsius.`; }
      else return { answer: 'I can answer questions about grievances, drains and flooding, buses, air quality, waste and temperature.', api: null };
      const r = api.call(p, path, body);
      return { answer: say(r.output), api: path, request: r.request };
    },

    // Monthly report on system performance (City OS Section 4, ICCC)
    report(p, month) {
      const m = /^\d{4}-\d{2}$/.test(month || '') ? month : iso(Date.now()).slice(0, 7);
      const calls = q.all(db, `SELECT route, COUNT(*) n, SUM(CASE WHEN status=200 THEN 1 ELSE 0 END) ok, AVG(ms) ms FROM api_calls WHERE service='CIL' AND substr(ts,1,7)=? GROUP BY route ORDER BY n DESC`, m);
      const alerts = q.all(db, 'SELECT domain, COUNT(*) n FROM alerts WHERE substr(ts,1,7)=? GROUP BY domain', m);
      const beats = q.all(db, `SELECT service, COUNT(*) n, SUM(up) up FROM heartbeats WHERE substr(ts,1,7)=? GROUP BY service`, m);
      audit.log('CIL', actorOf(p), 'Monthly report generated', m);
      return { month: m, city: cfg.cityName, apiUse: calls.map(c => ({ ...c, ms: round(c.ms) })), alertsByDomain: alerts, uptime: beats.map(b => ({ service: b.service, checks: b.n, uptimePercent: round(100 * b.up / b.n, 2) })), generatedAt: iso(Date.now()) };
    },

    serviceSelf: () => serviceSelf(),
    // Federation (City OS Section 1, Figure 2): the same API asked of every city, then aggregated.
    async federate(p, path, body = {}) {
      const a = byPath(path); need(a, 404, 'no CIL API at ' + path);
      const local = { city: cfg.cityName, ok: true, result: api.call(p, path, body) };
      const remote = await Promise.all(cfg.federationPeers.map(peer => callPeer(peer, path, body)));
      const all = [local, ...remote];
      const agg = aggregate(path, all.filter(x => x.ok).map(x => x.result));
      audit.log('CIL', actorOf(p), 'Federated query', `${path} across ${all.length} cities (${all.filter(x => x.ok).length} answered)`);
      return { api: path, cities: all.map(x => ({ city: x.city, ok: x.ok, error: x.error, output: x.result?.output })), aggregate: agg };
    },
  };

  function serviceSelf() {
    const c = q.get(db, `SELECT * FROM certs WHERE email=? AND status='valid' ORDER BY issued_at DESC`, cfg.cilServiceEmail);
    return c ? { via: 'service', email: c.email, cn: c.cn, cls: c.cls, serial: c.serial, dn: c.dn, kind: c.kind, orgId: c.org_id, role: 'service', username: null } : null;
  }
  function callPeer(peer, path, body) {
    const [name, url] = peer.includes('=') ? peer.split('=') : [peer, peer];
    return new Promise(resolve => {
      const u = new URL('/cil/v1' + path, url);
      const req = https.request(u, { method: 'POST', headers: { 'content-type': 'application/json' }, ca: cfg.federationCaFile && fs.existsSync(cfg.federationCaFile) ? fs.readFileSync(cfg.federationCaFile) : undefined, timeout: 8000 }, res => {
        let d = ''; res.on('data', c => (d += c)); res.on('end', () => { try { const j = JSON.parse(d); resolve(res.statusCode === 200 ? { city: j.city || name, ok: true, result: j } : { city: name, ok: false, error: j.error || 'HTTP ' + res.statusCode }); } catch { resolve({ city: name, ok: false, error: 'bad response' }); } });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', e => resolve({ city: name, ok: false, error: e.message }));
      req.end(JSON.stringify(body));
    });
  }
  return api;
}

function aggregate(path, results) {
  if (path === '/publictransit/fleetPerformance') {
    const v = results.map(r => r.output.fleetOnTimePercent);
    return { measure: 'bus regularity (on-time percent)', perCity: results.map(r => ({ city: r.city, value: r.output.fleetOnTimePercent })), mean: round(v.reduce((a, b) => a + b, 0) / (v.length || 1)) };
  }
  if (path === '/publictransit/financialPerformance') {
    return { measure: 'farebox ratio (revenue / cost) by mode', perCity: results.map(r => ({ city: r.city, modes: Object.fromEntries(r.output.rows.map(x => [x.mode, x.fareboxRatio])) })) };
  }
  const n = results.map(r => ({ city: r.city, rows: Array.isArray(r.output.rows) ? r.output.rows.length : null }));
  return { measure: 'row count per city', perCity: n };
}

function ngsiLd(a, out) {
  return { '@context': ['https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld'], id: `urn:ngsi-ld:AnalyticOutput:${a.id}:${Date.parse(out.computedAt)}`, type: 'AnalyticOutput',
    analytic: { type: 'Relationship', object: `urn:demo-cil:analytic:${a.id}` }, outputDataType: { type: 'Property', value: a.out },
    result: { type: 'Property', value: out.output, observedAt: out.computedAt } };
}
export { wardOf };
