// SCOS research layer (our addition on top of the City OS; not part of the two documents and not in requirements.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startCity } from './helpers.js';
import { q } from '../src/db.js';

const LINKS = JSON.parse(fs.readFileSync(new URL('../src/seed-data/kanpur-links-build.json', import.meta.url), 'utf8'));
const INC = JSON.parse(fs.readFileSync(new URL('../src/seed-data/kanpur-incidents-build.json', import.meta.url), 'utf8'));
let c;
before(async () => { c = await startCity({ config: { cityProfile: 'kanpur' } }); });
after(async () => { await c.stop(); });

test('the link register is the 39 links of the 52 build incidents, published as a public data exchange item', async () => {
  assert.equal(LINKS.length, 39);
  const ids = new Set(INC.map(i => i.incidentId));
  for (const l of LINKS) for (const id of l.incidentIds) assert.ok(ids.has(id), `${l.linkId} cites ${id}, which is not in the build set`);
  const item = await c.req('GET', '/catalogue/v1/items?id=' + encodeURIComponent('urn:demo-cat:deplinks/dependency-links-52'));
  assert.equal(item.status, 200);
  assert.match(item.body.itemDescription.value, /not part of the two documents/);
  const rows = await c.req('GET', '/resource/v1/search?id=' + encodeURIComponent('urn:demo-cat:deplinks/dependency-links-52'));
  assert.equal(rows.status, 200, JSON.stringify(rows.body));
  const about = (await c.req('GET', '/scos/v1')).body;
  assert.deepEqual([about.counts.links, about.counts.crossBoundary, about.counts.fromHazard, about.counts.incidents], [39, 25, 14, 52]);
  assert.equal(about.counts.byLevel.C1, 39, 'every link is C1 (news only); nothing is claimed above that');
  assert.match(about.note, /Not part of the two reference documents/);
});

test('the explorer gives upstream, downstream, owners, evidence and the incidents behind each link', async () => {
  const r = (await c.req('GET', '/scos/v1/explore?service=PWR')).body;
  assert.equal(r.service.owner, 'KESCO');
  const l03 = r.downstream.find(l => l.linkId === 'L-03');
  assert.deepEqual([l03.to, l03.incidents, l03.crossBoundary, l03.level], ['WAT', 8, true, 'C1']);
  assert.ok(r.upstream.some(l => l.from === 'RAIN'), 'rain can cause power cuts (L-06)');
  assert.ok(r.departmentsDownstream.some(d => d.startsWith('Kanpur Jal Sansthan')), JSON.stringify(r.departmentsDownstream));
  assert.ok(r.incidents.every(i => i.sourceUrl), 'each incident links to its news source');
  const k = (await c.req('GET', '/scos/v1/explore?department=KESCO')).body;
  assert.ok(k.handsOverTo.some(l => l.linkId === 'L-03') && k.receivesFrom.some(l => l.linkId === 'L-13'));
  assert.equal((await c.req('GET', '/scos/v1/explore?service=NOPE')).status, 404);
  const strong = (await c.req('GET', '/scos/v1/links?minIncidents=2')).body;
  assert.equal(strong.length, LINKS.filter(l => l.incidents >= 2).length);
});

test('the trace follows only real links, step by step, and lists who acts next', async () => {
  const t = (await c.req('POST', '/scos/v1/trace', { body: { start: 'RAIN' } })).body;
  assert.equal(t.minIncidents, 2);
  assert.ok(t.links.every(l => l.incidents >= 2 && l.level === 'C1'));
  const codes = t.affected.map(a => a.code);
  for (const x of ['DRN', 'ROAD', 'HOSP', 'PWR']) assert.ok(codes.includes(x), x);
  assert.equal(t.actions[0].department, 'Kanpur Nagar Nigam', 'rain itself has no owner; the drains department acts first');
  assert.ok(t.actions.every((a, i) => a.order === i + 1 && a.status === 'suggested'));
  // the prototype's assumed power -> pump -> drainage chain is not in the register, so it can never appear
  assert.ok(!t.links.some(l => l.from === 'PWR' && l.to === 'DRN'));
  const s2 = (await c.req('POST', '/scos/v1/trace', { body: { start: 'PWR', steps: 1 } })).body;
  assert.deepEqual(s2.actions.map(a => a.service), ['PWR', 'WAT', 'FIRE', 'HOSP', 'ORDER']);
  assert.equal((await c.req('POST', '/scos/v1/trace', { body: { start: 'PWR', steps: 9 } })).status, 400);
  const sc = (await c.req('GET', '/scos/v1/scenarios')).body;
  assert.deepEqual(sc.map(s => s.id), ['S1', 'S2', 'S3']);
  assert.ok(sc.every(s => s.links > 0 && s.incidents > 0));
});

test('only the control room may decide a suggested task; each decision goes into the signed audit log', async () => {
  const body = { scenario: 'S2', order: 2, decision: 'approve' };
  assert.equal((await c.req('POST', '/scos/v1/decisions', { body })).status, 401);
  const kesco = await c.login('officer.kesco');
  assert.equal((await kesco.as('POST', '/scos/v1/decisions', { body })).status, 403);
  const ctl = await c.login('control');
  const ok = await ctl.as('POST', '/scos/v1/decisions', { body });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.service, ok.body.department, ok.body.via], ['WAT', 'Kanpur Jal Sansthan; UP Jal Nigam', 'L-03']);
  assert.equal((await ctl.as('POST', '/scos/v1/decisions', { body: { ...body, decision: 'reject' } })).status, 400, 'a rejection needs a reason');
  assert.equal((await ctl.as('POST', '/scos/v1/decisions', { body: { ...body, decision: 'hold', reason: 'Waiting for KESCO restoration time' } })).status, 201);
  const rec = (await ctl.as('GET', '/scos/v1/decisions')).body;
  assert.deepEqual(rec.map(r => r.decision), ['hold', 'approve']);
  assert.equal((await kesco.as('GET', '/scos/v1/decisions')).status, 403);
  const row = q.get(c.app.db, "SELECT * FROM audit WHERE iface='SCOS' AND action='Task hold'");
  assert.match(row.detail, /S2 #2 WAT -> Kanpur Jal Sansthan; UP Jal Nigam via L-03: Waiting/);
  assert.equal(c.app.audit.verify().ok, true);
});

test('the link register is sealed like the incident register, and a quiet edit shows on the transparency page', async () => {
  let tr = (await c.req('GET', '/ops/v1/transparency')).body;
  assert.equal(tr.dependencyRegister.rows, 39);
  assert.equal(tr.dependencyRegister.unchanged, true);
  assert.equal(tr.incidentRegister.unchanged, true);
  const r = q.get(c.app.db, "SELECT n, data FROM table_rows WHERE item_id='urn:demo-cat:deplinks/dependency-links-52' AND data LIKE '%\"L-03\"%'");
  const d = JSON.parse(r.data); d.incidents = 80;
  q.run(c.app.db, 'UPDATE table_rows SET data=? WHERE item_id=? AND n=?', JSON.stringify(d), 'urn:demo-cat:deplinks/dependency-links-52', r.n);
  tr = (await c.req('GET', '/ops/v1/transparency')).body;
  assert.equal(tr.dependencyRegister.unchanged, false);
  assert.deepEqual(tr.dependencyRegister.changed, ['L-03']);
});

test('the default demo city has no SCOS registers and says so instead of failing', async () => {
  const d = await startCity();
  try {
    const a = (await d.req('GET', '/scos/v1')).body;
    assert.equal(a.counts.links, 0);
    assert.equal((await d.req('GET', '/ops/v1/transparency')).body.dependencyRegister, null);
  } finally { await d.stop(); }
});

test('C5 and C7: the home page tells the three-layer story, the menu has 7 items, and the developer page and OpenAPI are served', async () => {
  const home = (await c.req('GET', '/', { raw: true })).body;
  assert.match(home, /<section id="story" class="sec scos" hidden/);
  const menu = home.slice(home.indexOf('id="menu"'), home.indexOf('id="find-btn"'));
  assert.equal((menu.match(/<a /g) || []).length, 7, 'menu: City today, Map, Dashboards, Incidents and dependencies, Open data, About, Help');
  for (const id of ['depts', 'data', 'status', 'open']) assert.match(home, new RegExp(`class="subnav"[^]*href="#${id}"`), id);
  assert.match(home, /href="\/developers\.html"/);
  const dev = await c.req('GET', '/developers.html', { raw: true });
  assert.equal(dev.status, 200);
  assert.match(dev.body, /not part of|not in the two documents/);
  assert.match(dev.body, /Not an official government website/);
  assert.doesNotMatch(dev.body, /<script>|style="/, 'no inline script or style (strict CSP)');
  const o = (await c.req('GET', '/scos/v1/openapi')).body;
  assert.equal(o.openapi, '3.0.3');
  for (const p of ['/scos/v1', '/scos/v1/explore', '/scos/v1/trace', '/scos/v1/decisions', '/scos/v1/scenarios']) assert.ok(o.paths[p], p);
  assert.deepEqual(o.paths['/scos/v1/decisions'].post.requestBody.content['application/json'].schema.properties.decision.enum, ['approve', 'hold', 'reject']);
  const con = (await c.req('GET', '/app.js', { raw: true })).body;
  assert.match(con, /\['scos', 'SCOS tasks', 'operator admin auditor'\]/, 'the control room console has the SCOS tasks screen');
});

test('incident pages: steps, sources and links for each of the 52 build incidents, and the map marks approximate places', async () => {
  const all = (await c.req('GET', '/scos/v1/incidents')).body;
  assert.equal(all.length, 52);
  assert.deepEqual(new Set(all.map(x => x.incidentId)), new Set(INC.map(i => i.incidentId)), 'only the build incidents, never the held-back ones');
  const d = (await c.req('GET', '/scos/v1/incident?id=KI-045')).body;
  assert.equal(d.incident.incidentId, 'KI-045');
  assert.ok(d.steps.length >= 2 && d.steps.every((s, i) => s.step === i + 1), 'steps in order');
  assert.ok(d.sources.length >= 1 && d.sources.every(s => /^https?:\/\//.test(s.url) && s.checkedByHand === 'No'));
  assert.deepEqual(d.links.map(l => l.linkId).sort(), LINKS.filter(l => l.incidentIds.includes('KI-045')).map(l => l.linkId).sort(), 'the links that cite it, no more');
  assert.equal(d.total, 52);
  assert.equal((await c.req('GET', '/scos/v1/incident?id=KI-999')).status, 404);
  assert.equal((await c.req('GET', '/scos/v1/incident?id=x')).status, 400);
  // placement: one place gets a point; a report naming many areas is flagged so the map does not pretend it is one spot
  const rows = (await c.req('GET', '/resource/v1/search?id=' + encodeURIComponent('urn:demo-cat:incidents/past-incidents-news'))).body.results;
  const by = Object.fromEntries(rows.map(r => [r.incidentId, r]));
  assert.equal(by['KI-005'].placement, 'many', '80 localities is not one point');
  assert.equal(by['KI-001'].placement, 'one');
  assert.ok(rows.every(r => r.placement === 'none' ? !r.location : !!r.location));
  const page = await c.req('GET', '/incident.html', { raw: true });
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.body, /<script>|style="/, 'strict CSP: no inline script or style');
  const js = (await c.req('GET', '/scos.js', { raw: true })).body;
  assert.match(js, /Only links from the register are drawn/, 'the scenario animation draws trace links only');
});

test('the control room can enter a new incident: it is traced on the frozen map, decided and audited, but never added to the map', async () => {
  const body = { title: 'Water main damaged during digging (demo example)', date: '2026-11-20', area: 'Kalyanpur', description: 'Made-up demo example.', source: 'Demo example', start: 'WORKS' };
  assert.equal((await c.req('POST', '/scos/v1/new-incidents', { body })).status, 401);
  const kesco = await c.login('officer.kesco');
  assert.equal((await kesco.as('POST', '/scos/v1/new-incidents', { body })).status, 403);
  const ctl = await c.login('control');
  assert.equal((await ctl.as('POST', '/scos/v1/new-incidents', { body: { ...body, start: 'NOPE' } })).status, 400);
  const before = (await c.req('GET', '/scos/v1')).body.counts;
  const r = await ctl.as('POST', '/scos/v1/new-incidents', { body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.incident.id, 'NEW-001');
  assert.ok(r.body.trace.affected.some(a => a.code === 'WAT'), 'digging can damage water supply (L-08)');
  assert.deepEqual((await c.req('GET', '/scos/v1')).body.counts, before, 'the map and the past-incident register do not change');
  const order = r.body.trace.actions.find(a => a.service === 'WAT').order;
  const d = await ctl.as('POST', '/scos/v1/decisions', { body: { scenario: 'NEW-001', order, decision: 'approve' } });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.equal(d.body.scenario, 'NEW-001');
  assert.equal((await ctl.as('GET', '/scos/v1/new-incidents')).body[0].id, 'NEW-001');
  assert.ok(q.get(c.app.db, "SELECT * FROM audit WHERE iface='SCOS' AND action='New incident entered'"));
  assert.match(q.get(c.app.db, "SELECT * FROM audit WHERE iface='SCOS' AND action='Task approve' AND detail LIKE 'NEW-001%'").detail, /WAT/);
  assert.equal(c.app.audit.verify().ok, true);
});

test('reset demo hides earlier new incidents and decisions from the SCOS screens but keeps the audit log', async () => {
  const ctl = await c.login('control');
  const kesco = await c.login('officer.kesco');
  assert.equal((await kesco.as('POST', '/scos/v1/reset-demo', { body: {} })).status, 403);
  await ctl.as('POST', '/scos/v1/new-incidents', { body: { title: 'Before reset (demo)', date: '2026-11-20', description: 'Demo.', start: 'PWR' } });
  const auditBefore = q.get(c.app.db, 'SELECT COUNT(*) AS n FROM audit').n;
  const r = await ctl.as('POST', '/scos/v1/reset-demo', { body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.hidden.incidents >= 1);
  assert.equal((await ctl.as('GET', '/scos/v1/new-incidents')).body.length, 0);
  assert.equal((await ctl.as('GET', '/scos/v1/decisions')).body.length, 0);
  assert.equal((await ctl.as('POST', '/scos/v1/decisions', { body: { scenario: 'NEW-001', order: 1, decision: 'approve' } })).status, 400, 'a hidden incident can no longer be decided');
  const after = await ctl.as('POST', '/scos/v1/new-incidents', { body: { title: 'After reset (demo)', date: '2026-11-21', description: 'Demo.', start: 'RAIN' } });
  assert.notEqual(after.body.incident.id, 'NEW-001', 'ids keep counting, so audit entries stay unambiguous');
  assert.deepEqual((await ctl.as('GET', '/scos/v1/new-incidents')).body.map(x => x.id), [after.body.incident.id]);
  assert.ok(q.get(c.app.db, 'SELECT COUNT(*) AS n FROM audit').n > auditBefore, 'nothing removed from the audit log');
  assert.ok(q.get(c.app.db, "SELECT * FROM audit WHERE iface='SCOS' AND action='Demo reset'"));
  assert.equal(c.app.audit.verify().ok, true);
});

test('demo temperatures follow the season and the time of day', async () => {
  const { seasonalTemp } = await import('../src/util.js');
  const novNight = seasonalTemp(Date.parse('2026-11-21T16:00:00Z')), mayAfternoon = seasonalTemp(Date.parse('2026-05-21T09:30:00Z'));
  assert.ok(novNight > 10 && novNight < 22, String(novNight));
  assert.ok(mayAfternoon > 36, String(mayAfternoon));
});
