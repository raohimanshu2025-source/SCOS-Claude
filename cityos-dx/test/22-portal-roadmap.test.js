// Public portal additions from the 2026 roadmap (our additions beyond the two documents):
// the past incident register is sealed, and the portal can be installed and opened offline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCity } from './helpers.js';
import { q } from '../src/db.js';

let c;
before(async () => { c = await startCity({ config: { cityProfile: 'kanpur' } }); });
after(async () => { await c.stop(); });

test('the 52 past incidents are sealed in the signed audit log, and a quiet edit to one row is caught', async () => {
  const before = (await c.req('GET', '/ops/v1/transparency')).body.incidentRegister;
  assert.equal(before.rows, 52);
  assert.equal(before.unchanged, true);
  assert.equal(before.sealInAudit, true);
  assert.match(before.digest, /^[0-9a-f]{64}$/);
  // someone edits an incident straight in the database, without going through any API
  const row = q.get(c.app.db, "SELECT t.item_id, t.n, t.data FROM table_rows t JOIN items i ON i.id=t.item_id WHERE t.data LIKE '%\"incidentId\":\"KI-001\"%'");
  const d = JSON.parse(row.data); d.impact = 'changed quietly';
  q.run(c.app.db, 'UPDATE table_rows SET data=? WHERE item_id=? AND n=?', JSON.stringify(d), row.item_id, row.n);
  const after = (await c.req('GET', '/ops/v1/transparency')).body.incidentRegister;
  assert.equal(after.unchanged, false);
  assert.deepEqual(after.changed, ['KI-001']);
  // swapping the stored seal for one made from the edited rows does not help: its digest is not in the audit log
  const kv = JSON.parse(q.get(c.app.db, "SELECT v FROM kv WHERE k='seal:incidents'").v);
  q.run(c.app.db, "UPDATE kv SET v=? WHERE k='seal:incidents'", JSON.stringify({ ...kv, digest: after.digest }));
  const swapped = (await c.req('GET', '/ops/v1/transparency')).body.incidentRegister;
  assert.equal(swapped.sealInAudit, false);
  assert.equal(swapped.unchanged, false);
});

test('the portal can be installed as an app and keeps only public data for offline use', async () => {
  const home = (await c.req('GET', '/', { raw: true })).body;
  assert.match(home, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  const m = await c.req('GET', '/manifest.webmanifest', { raw: true });
  assert.equal(m.status, 200);
  assert.match(m.headers['content-type'], /application\/manifest\+json/);
  const man = JSON.parse(m.body);
  assert.match(man.name, /demo/i, 'the installed app is still called a demo');
  assert.match(man.description, /Not an official government website/);
  for (const i of man.icons) assert.equal((await c.req('GET', i.src, { raw: true })).status, 200, i.src);
  const sw = (await c.req('GET', '/sw.js', { raw: true })).body;
  assert.match(sw, /credentials === 'omit'/, 'only reads made without a login cookie are kept');
  assert.doesNotMatch(sw, /console\.html|\/auth\//, 'the officer console and logins are never kept');
  for (const f of ['/smart.js', '/modern.css']) assert.equal((await c.req('GET', f, { raw: true })).status, 200, f);
});
