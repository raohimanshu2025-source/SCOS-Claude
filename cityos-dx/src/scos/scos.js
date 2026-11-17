// SCOS research layer (Smart City Operations Support). OUR ADDITION: not part of the BIS Data Exchange draft or the
// City OS paper, and not counted in docs/requirements.json. It sits on top of the City OS as an application:
// it reads the dependency link register and the past incident register through the data exchange (catalogue items
// with their normal access rules), and offers
//   - the link register and a per-service / per-department explorer (upstream, downstream, owners, evidence),
//   - a cascade trace: from a first failure, follow the links step by step (plain rules, no machine learning),
//   - the order in which departments are reached ("who acts next"), as a suggestion only,
//   - officer decisions (approve, hold, reject) on those suggestions, recorded in the signed audit log.
// Every link is evidence level C1 (news, one source family, single coder, not checked by hand). Nothing here is
// validated; the sealed-incident test and officer checks in the thesis method are still to come.
import { q } from '../db.js';
import { iso, need } from '../util.js';
import { actorOf } from '../identity/identity.js';

export const SCOS_NOTE = 'SCOS research layer, added on top of the City OS by the SCOS M.Tech research (IIT Kanpur). Not part of the two reference documents. Links are coded from news reports of past incidents (evidence level C1, single coder, not checked by hand). Suggestions only: nothing is sent to any department, and nothing here has been validated.';
export const EVIDENCE = [
  { level: 'C0', meaning: 'Assumed: no source yet' },
  { level: 'C1', meaning: 'Seen in news reports (one source family)' },
  { level: 'C2', meaning: 'Confirmed by a department record or an officer' },
  { level: 'C3', meaning: 'Agreed by an expert panel (Delphi, planned)' },
];
// The three demonstration scenarios, chosen by how often they appear in the 52 build incidents (audit, 17 Nov 2026).
export const SCENARIOS = [
  { id: 'S1', start: 'RAIN', title: 'Heavy rain and waterlogging', why: 'Most common pattern in the register: drains overflow, then roads, buildings and hospital access are hit.' },
  { id: 'S2', start: 'PWR', title: 'Power cut hits water supply', why: 'The clearest hand-over between two departments in the register: power supply (KESCO) to water supply (Jal Sansthan).' },
  { id: 'S3', start: 'WORKS', title: 'Road works or digging damage', why: 'Digging by one agency damages water, drainage, power or roads owned by others: prevention needs the dependency list before work starts.' },
];
const DECISIONS = ['approve', 'hold', 'reject'];
const cleanOwner = s => String(s || '').replace(/\s*\([^)]*\)/g, '').trim();

export function makeScos({ db, audit, catalogue, resource }) {
  q.run(db, `CREATE TABLE IF NOT EXISTS scos_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, scenario TEXT NOT NULL, step INTEGER NOT NULL,
    service TEXT NOT NULL, department TEXT NOT NULL, via TEXT, decision TEXT NOT NULL, reason TEXT, actor TEXT NOT NULL, ts TEXT NOT NULL)`);
  const groupItems = key => catalogue.all('resourceItem').filter(i => i.doc.resourceServerGroup?.value === `urn:demo-cat:group/${key}`);
  // Read through the data exchange. Both registers are public catalogue items; if a city marks them otherwise,
  // the caller must hold a token like any other consumer (the same rule the City Intelligence Layer follows).
  const rowsOfGroup = (key, p) => groupItems(key).flatMap(it => {
    if (it.policy.label !== 'public') need(p?.email, 401, `the SCOS register ${it.id} is not public on this data exchange`);
    return resource.rowsOf(it);
  });

  function load(p) {
    const links = rowsOfGroup('deplinks', p).map(r => ({
      ...r, incidentIds: String(r.incidentIds || '').split(',').map(s => s.trim()).filter(Boolean),
      crossBoundary: r.handover === 'Yes', fromHazard: /hazard/i.test(r.handover), level: String(r.evidence).slice(0, 2),
    }));
    const incidents = new Map(rowsOfGroup('incidents', p).map(r => [r.incidentId, r]));
    const nodes = new Map();
    const node = (code, name, owner) => { if (!nodes.has(code)) nodes.set(code, { code, name, owner: cleanOwner(owner), ownerFull: owner, trigger: false, linksIn: 0, linksOut: 0 }); return nodes.get(code); };
    for (const l of links) {
      const a = node(l.fromCode, l.from, l.ownerFrom), b = node(l.toCode, l.to, l.ownerTo);
      a.linksOut++; b.linksIn++; if (l.fromHazard) a.trigger = true;
    }
    return { links, nodes, incidents };
  }
  const pubLink = l => ({ linkId: l.linkId, from: l.fromCode, to: l.toCode, fromName: l.from, toName: l.to, type: l.type, incidents: l.incidents, statedInSource: l.statedInSource, spreadRatio: l.spreadRatio,
    ownerFrom: cleanOwner(l.ownerFrom), ownerTo: cleanOwner(l.ownerTo), crossBoundary: l.crossBoundary, fromHazard: l.fromHazard, evidence: l.evidence, level: l.level, incidentIds: l.incidentIds });
  const incBrief = (inc, id) => { const x = inc.get(id); return x ? { incidentId: id, date: x.date, type: x.type, summary: x.summary, sourceUrl: x.sourceUrl, publisher: x.publisher } : { incidentId: id }; };
  const minN = v => { const n = v === undefined || v === '' ? 1 : Number(v); need(Number.isInteger(n) && n >= 1 && n <= 100, 400, 'minIncidents must be a whole number from 1 to 100'); return n; };

  return {
    about(p) {
      const { links, nodes, incidents } = load(p);
      return { note: SCOS_NOTE, layer: 'SCOS (our addition, on top of the City OS)', evidence: EVIDENCE, scenarios: SCENARIOS,
        counts: { links: links.length, crossBoundary: links.filter(l => l.crossBoundary).length, fromHazard: links.filter(l => l.fromHazard).length, services: nodes.size, incidents: incidents.size,
          byLevel: Object.fromEntries(EVIDENCE.map(e => [e.level, links.filter(l => l.level === e.level).length])) },
        sources: { links: groupItems('deplinks').map(i => i.id), incidents: groupItems('incidents').map(i => i.id) } };
    },
    services(p) { return [...load(p).nodes.values()].sort((a, b) => (b.linksIn + b.linksOut) - (a.linksIn + a.linksOut) || a.code.localeCompare(b.code)); },
    links(p, query = {}) {
      const { links } = load(p); const n = minN(query.minIncidents);
      const svc = query.service ? String(query.service).toUpperCase() : null, dir = query.direction || 'both', dept = query.department ? String(query.department).toLowerCase() : null;
      need(['up', 'down', 'both'].includes(dir), 400, 'direction must be up, down or both');
      return links.filter(l => l.incidents >= n
        && (!svc || (dir !== 'up' && l.fromCode === svc) || (dir !== 'down' && l.toCode === svc))
        && (!dept || l.ownerFrom.toLowerCase().includes(dept) || l.ownerTo.toLowerCase().includes(dept))
        && (query.crossBoundary === undefined || String(l.crossBoundary) === String(query.crossBoundary))).map(pubLink);
    },
    // Upstream (what can cause it) and downstream (what it can cause) of one service, or the hand-overs of one department.
    explore(p, query = {}) {
      const { links, nodes, incidents } = load(p); const n = minN(query.minIncidents);
      if (query.department) {
        const d = String(query.department).toLowerCase(); need(d.length >= 3, 400, 'department: give at least 3 letters');
        const mine = l => cleanOwner(l.ownerFrom).toLowerCase().includes(d), theirs = l => cleanOwner(l.ownerTo).toLowerCase().includes(d);
        const use = links.filter(l => l.incidents >= n && l.crossBoundary);
        return { department: query.department, note: SCOS_NOTE,
          handsOverTo: use.filter(l => mine(l) && !theirs(l)).map(pubLink), receivesFrom: use.filter(l => theirs(l) && !mine(l)).map(pubLink) };
      }
      const code = String(query.service || '').toUpperCase(); const s = nodes.get(code);
      need(s, 404, `no service ${code || '(none given)'}; see /scos/v1/services`);
      const up = links.filter(l => l.toCode === code && l.incidents >= n), down = links.filter(l => l.fromCode === code && l.incidents >= n);
      const ids = [...new Set([...up, ...down].flatMap(l => l.incidentIds))].sort();
      return { service: s, note: SCOS_NOTE, upstream: up.map(pubLink), downstream: down.map(pubLink),
        departmentsDownstream: [...new Set(down.filter(l => l.crossBoundary).map(l => cleanOwner(l.ownerTo)))],
        incidents: ids.map(id => incBrief(incidents, id)) };
    },
    // Cascade trace: breadth first from the first failure, at most `steps` steps, only links seen in at least
    // `minIncidents` incidents (default 2, the rule for the draft test map). Plain rules; every step names its link.
    trace(p, body = {}) {
      const { links, nodes, incidents } = load(p);
      const start = String(body.start || '').toUpperCase(); need(nodes.has(start), 404, `no service ${start || '(none given)'}; see /scos/v1/services`);
      const steps = body.steps === undefined ? 3 : Number(body.steps); need(Number.isInteger(steps) && steps >= 1 && steps <= 6, 400, 'steps must be 1 to 6');
      const n = minN(body.minIncidents ?? 2);
      const use = links.filter(l => l.incidents >= n);
      const reached = new Map([[start, { code: start, step: 0, via: null }]]); let frontier = [start]; const used = [];
      for (let k = 1; k <= steps && frontier.length; k++) {
        const next = [];
        for (const f of frontier) for (const l of use.filter(x => x.fromCode === f).sort((a, b) => b.incidents - a.incidents)) {
          used.push({ step: k, ...pubLink(l) });
          if (!reached.has(l.toCode)) { reached.set(l.toCode, { code: l.toCode, step: k, via: l.linkId }); next.push(l.toCode); }
        }
        frontier = next;
      }
      const affected = [...reached.values()].map(r => ({ ...r, name: nodes.get(r.code).name, owner: nodes.get(r.code).owner, trigger: nodes.get(r.code).trigger }));
      // Who acts next: owners in the order their service is reached (a suggestion for an officer to approve, not an order).
      const seen = new Set(), actions = [];
      for (const a of affected) {
        if (a.trigger && a.step === 0 && /no owner/i.test(nodes.get(a.code).ownerFull)) continue; // a hazard such as rain has no owner
        if (!a.owner || seen.has(a.owner + a.code)) continue; seen.add(a.owner + a.code);
        actions.push({ order: actions.length + 1, step: a.step, service: a.code, serviceName: a.name, department: a.owner, via: a.via, status: 'suggested' });
      }
      const ids = [...new Set(used.flatMap(l => l.incidentIds))].sort();
      return { start, steps, minIncidents: n, note: SCOS_NOTE, method: 'Breadth-first trace over the link register; a link is used if it was seen in at least minIncidents past incidents. No machine learning, no weights.',
        affected, links: used, actions, crossBoundaryLinks: used.filter(l => l.crossBoundary).length, incidents: ids.map(id => incBrief(incidents, id)) };
    },
    scenarios(p) { return SCENARIOS.map(s => { const t = this.trace(p, { start: s.start }); return { ...s, affected: t.affected.length, links: t.links.length, crossBoundaryLinks: t.crossBoundaryLinks, incidents: t.incidents.length }; }); },
    decide(p, body = {}) {
      need(p.role === 'operator', p.role === 'anonymous' ? 401 : 403, 'only the ICCC operator (control room) may approve, hold or reject a suggested task');
      const sc = SCENARIOS.find(s => s.id === body.scenario) || (body.start && { id: 'custom', start: String(body.start).toUpperCase() }); need(sc, 400, 'scenario must be S1, S2 or S3, or give start');
      need(DECISIONS.includes(body.decision), 400, 'decision must be approve, hold or reject');
      const t = this.trace(p, { start: sc.start, steps: body.steps, minIncidents: body.minIncidents });
      const a = t.actions.find(x => x.order === Number(body.order)); need(a, 404, 'no suggested task with that order number in this trace');
      const reason = String(body.reason || '').slice(0, 500);
      need(body.decision === 'approve' || reason.trim(), 400, 'give a reason when you hold or reject a task');
      const ts = iso(Date.now()), actor = actorOf(p);
      const r = q.run(db, 'INSERT INTO scos_decisions (scenario, step, service, department, via, decision, reason, actor, ts) VALUES (?,?,?,?,?,?,?,?,?)', sc.id, a.step, a.service, a.department, a.via, body.decision, reason, actor, ts);
      audit.log('SCOS', actor, `Task ${body.decision}`, `${sc.id} #${a.order} ${a.service} -> ${a.department}${a.via ? ' via ' + a.via : ''}${reason ? ': ' + reason : ''}`);
      return { id: Number(r.lastInsertRowid), scenario: sc.id, ...a, decision: body.decision, reason, decidedBy: actor, ts, note: 'Recorded only. SCOS does not send anything to the department.' };
    },
    decisions(p, query = {}) {
      need(['operator', 'admin', 'auditor'].includes(p.role), p.role === 'anonymous' ? 401 : 403, 'the decision record is for the control room, administrators and auditors');
      return q.all(db, 'SELECT * FROM scos_decisions ORDER BY id DESC LIMIT ?', Math.min(500, Number(query.limit) || 100));
    },
  };
}


// OpenAPI 3.0 description of the SCOS routes, for the developer page (our addition, like the routes themselves).
export function scosOpenapi() {
  const ok = (description, schema = { type: 'object' }) => ({ 200: { description, content: { 'application/json': { schema } } } });
  const err = { 400: { description: 'Bad input' }, 404: { description: 'No such service, scenario or task' } };
  const q = (name, description, schema = { type: 'string' }) => ({ name, in: 'query', required: false, description, schema });
  const minInc = q('minIncidents', 'Use only links seen in at least this many past incidents (1 to 100).', { type: 'integer', minimum: 1, maximum: 100 });
  return {
    openapi: '3.0.3',
    info: { title: 'SCOS research layer API', version: '1.0.0', description: SCOS_NOTE },
    servers: [{ url: '/' }],
    tags: [{ name: 'SCOS', description: 'Smart City Operations Support: our addition on top of the City OS. Not part of the BIS Data Exchange draft or the City OS paper.' }],
    paths: {
      '/scos/v1': { get: { tags: ['SCOS'], summary: 'What the layer is, its counts and its sources', responses: ok('About the layer') } },
      '/scos/v1/services': { get: { tags: ['SCOS'], summary: 'City services in the link register, with owner and number of links', responses: ok('Services', { type: 'array', items: { type: 'object' } }) } },
      '/scos/v1/links': { get: { tags: ['SCOS'], summary: 'The dependency links, filtered', parameters: [q('service', 'Service code, e.g. PWR'), q('direction', 'up, down or both'), q('department', 'Part of a department name'), q('crossBoundary', 'true for hand-overs between departments only'), minInc], responses: { ...ok('Links', { type: 'array', items: { type: 'object' } }), ...err } } },
      '/scos/v1/explore': { get: { tags: ['SCOS'], summary: 'Upstream and downstream of one service, or the hand-overs of one department', parameters: [q('service', 'Service code, e.g. PWR'), q('department', 'Part of a department name, at least 3 letters'), minInc], responses: { ...ok('Explorer result'), ...err } } },
      '/scos/v1/trace': { post: { tags: ['SCOS'], summary: 'Follow the links step by step from a first failure and list who acts next (suggestion only)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['start'], properties: { start: { type: 'string', example: 'PWR' }, steps: { type: 'integer', minimum: 1, maximum: 6, default: 3 }, minIncidents: { type: 'integer', default: 2 } } } } } },
        responses: { ...ok('Trace: affected services, links used, suggested actions, incidents behind them'), ...err } } },
      '/scos/v1/scenarios': { get: { tags: ['SCOS'], summary: 'The three demonstration scenarios with their trace sizes', responses: ok('Scenarios', { type: 'array', items: { type: 'object' } }) } },
      '/scos/v1/decisions': {
        post: { tags: ['SCOS'], summary: 'Approve, hold or reject one suggested task (ICCC operator login only; written to the signed audit log)', security: [{ session: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['scenario', 'order', 'decision'], properties: { scenario: { type: 'string', enum: SCENARIOS.map(s => s.id) }, order: { type: 'integer' }, decision: { type: 'string', enum: DECISIONS }, reason: { type: 'string', description: 'Needed for hold and reject' } } } } } },
          responses: { 201: { description: 'Recorded (nothing is sent to the department)' }, 401: { description: 'Not logged in' }, 403: { description: 'Not the ICCC operator' }, ...err } },
        get: { tags: ['SCOS'], summary: 'The decision record (operator, administrator, auditor)', security: [{ session: [] }], parameters: [q('limit', 'At most 500', { type: 'integer' })], responses: { ...ok('Decisions', { type: 'array', items: { type: 'object' } }), 401: { description: 'Not logged in' }, 403: { description: 'Role not allowed' } } },
      },
    },
    components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'dx_session', description: 'Officer login session from POST /auth/v1/login; state-changing calls also need the x-csrf-token header.' } } },
  };
}
