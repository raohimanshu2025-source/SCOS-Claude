// Citizen alerts with officer approval, the transparency figures and the help and policy page
// (additions beyond the two documents, listed in docs/DOCUMENT_CONFORMANCE.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCity } from './helpers.js';

let c;
before(async () => { c = await startCity({ config: { cityProfile: 'kanpur' } }); });
after(async () => { await c.stop(); });

const pub = async () => (await c.req('GET', '/cil/v1/citizen-alerts')).body;

test('the public sees only approved alerts, with no officer names or e-mail addresses', async () => {
  const list = await pub();
  assert.equal(list.length, 1, 'the seed has one approved alert and one waiting');
  assert.equal(list[0].kind, 'flood');
  assert.ok(list[0].titleHi && list[0].messageHi, 'Hindi text is published too');
  assert.doesNotMatch(JSON.stringify(list), /@|drafted|decided_by|control/);
});

test('an officer drafts, a different control room officer approves, and the alert reaches the portal', async () => {
  const anon = await c.req('POST', '/cil/v1/citizen-alerts', { body: { kind: 'water', level: 'info', title: 'x', message: 'y' } });
  assert.equal(anon.status, 401);
  const kjs = await c.login('officer.kjs'), ctl = await c.login('control'), staff = await c.login('staff.kjs');
  assert.equal((await staff.as('POST', '/cil/v1/citizen-alerts', { body: { kind: 'water', level: 'info', title: 'x', message: 'y' } })).status, 403, 'staff cannot write alerts');
  const bad = await kjs.as('POST', '/cil/v1/citizen-alerts', { body: { kind: 'tsunami', level: 'info', title: 'x', message: 'y' } });
  assert.equal(bad.status, 400);
  const d = await kjs.as('POST', '/cil/v1/citizen-alerts', { body: { kind: 'water', level: 'advisory', area: 'Zone 3', hours: 6, title: 'Test: low pressure', message: 'Store water tonight.' } });
  assert.equal(d.status, 201); assert.equal(d.body.status, 'pending'); assert.match(d.body.department, /Jal Sansthan/);
  assert.ok(!(await pub()).some(a => a.id === d.body.id), 'not public before approval');
  assert.equal((await kjs.as('POST', '/cil/v1/citizen-alerts/decide', { body: { id: d.body.id, approve: true } })).status, 403, 'a department officer cannot approve');
  const ok = await ctl.as('POST', '/cil/v1/citizen-alerts/decide', { body: { id: d.body.id, approve: true, note: 'checked pressure readings' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.status, 'approved');
  assert.ok(Date.parse(ok.body.expires_at) - Date.parse(ok.body.decided_at) === 6 * 3600e3, 'shown for the hours asked');
  assert.ok((await pub()).some(a => a.id === d.body.id), 'public after approval');
  assert.equal((await ctl.as('POST', '/cil/v1/citizen-alerts/decide', { body: { id: d.body.id, approve: false } })).status, 409, 'cannot decide twice');
  assert.equal((await kjs.as('POST', '/cil/v1/citizen-alerts/withdraw', { body: { id: d.body.id } })).status, 200, 'the writer can withdraw');
  assert.ok(!(await pub()).some(a => a.id === d.body.id), 'gone after withdrawal');
  const audit = (await (await c.login('auditor')).as('GET', '/ops/v1/audit?iface=CIL&limit=50')).body.map(e => e.action);
  for (const a of ['Citizen alert drafted', 'Citizen alert approved', 'Citizen alert withdrawn']) assert.ok(audit.includes(a), a);
});

test('two-person rule: the control room cannot approve its own alert, the administrator can', async () => {
  const ctl = await c.login('control'), admin = await c.login('admin');
  const d = await ctl.as('POST', '/cil/v1/citizen-alerts', { body: { kind: 'traffic', level: 'warning', area: 'Zone 1', title: 'Test: road closed', message: 'Use the other route.' } });
  assert.equal(d.status, 201);
  const self = await ctl.as('POST', '/cil/v1/citizen-alerts/decide', { body: { id: d.body.id, approve: true } });
  assert.equal(self.status, 403); assert.match(self.body.error, /two-person/);
  const r = await admin.as('POST', '/cil/v1/citizen-alerts/decide', { body: { id: d.body.id, approve: false, note: 'not needed' } });
  assert.equal(r.body.status, 'refused');
  assert.equal((await c.req('GET', '/cil/v1/citizen-alerts/all')).status, 401, 'the full list needs a login');
  const all = (await (await c.login('auditor')).as('GET', '/cil/v1/citizen-alerts/all')).body;
  assert.ok(all.some(a => a.status === 'refused' && a.note === 'not needed'));
});

test('transparency figures are public and hold counts only', async () => {
  const r = await c.req('GET', '/ops/v1/transparency');
  assert.equal(r.status, 200);
  const o = r.body;
  assert.ok(o.departments >= 11);
  assert.ok(o.datasets.public > 0 && o.datasets.confidential > 0);
  assert.ok(o.accessRequests.pending >= 1, 'the seeded Fire Service request is waiting');
  assert.ok(o.sharing.some(s => /Jal Sansthan/.test(s.from) && s.datasets > 0), JSON.stringify(o.sharing));
  assert.equal(o.audit.chainIntact, true);
  assert.ok(o.audit.events > 0);
  assert.doesNotMatch(JSON.stringify(o), /@/, 'no e-mail addresses');
});

test('help and policy page has every section in English and Hindi, linked from the portal footer', async () => {
  const info = (await c.req('GET', '/info.html', { raw: true })).body;
  for (const id of ['help', 'emergency', 'accessibility', 'privacy', 'terms', 'copyright', 'contact', 'sitemap']) {
    assert.match(info, new RegExp(`<section id="${id}"`), id);
  }
  assert.ok((info.match(/data-l="hi"/g) || []).length >= 8, 'Hindi blocks present');
  assert.match(info, /not an official website/i);
  assert.match(info, /Digital Personal Data Protection Act, 2023/);
  const home = (await c.req('GET', '/', { raw: true })).body;
  for (const id of ['help', 'accessibility', 'privacy', 'terms', 'copyright', 'contact', 'sitemap']) assert.match(home, new RegExp(`href="/info.html#${id}"`), id);
  assert.match(home, /id="calerts"/); assert.match(home, /id="open"/);
});
