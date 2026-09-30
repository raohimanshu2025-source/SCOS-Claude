// Authorization service: Figure 2 flow, policy P = (C, A), classes, consent, licence, revocation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCity } from './helpers.js';

let c;
before(async () => { c = await startCity(); });
after(async () => { await c.stop(); });

const DRAIN = 'urn:demo-cat:drains/drain-1';
const FARE = 'urn:demo-cat:fare/fare-revenue';
const WASTE = 'urn:demo-cat:swm/waste-daily';
const GRIEV = 'urn:demo-cat:griev/grievance-records';
const AQ = 'urn:demo-cat:aqm/aqm-1';

test('[BIS-58][BIS-99][BIS-55][BIS-22] full Figure 2 flow: 401 without token, token, data, introspection trace', async () => {
  const noTok = await c.req('GET', `/resource/v1/latest?id=${DRAIN}`, { as: 'control@mc.demo-city.example' });
  assert.equal(noTok.status, 401);
  assert.match(noTok.headers['www-authenticate'], /DX realm=.*as_uri="https:\/\/auth\.demo-city\.example\/auth\/v1\/token"/);
  const t = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: DRAIN }], purpose: 'flood watch' } });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body['token-type'], 'IUDX'); // Figure 2 step 5
  assert.equal(t.body['expires-in'], 3600);
  const r = await c.req('GET', `/resource/v1/latest?id=${DRAIN}&trace=1`, { as: 'control@mc.demo-city.example', token: t.body.token });
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.level === 'number');
  assert.deepEqual(r.body.authorizationFlow.map(s => s.step), [6, 7, 8, 9, 10, 11]);
  const again = await c.req('GET', `/resource/v1/latest?id=${DRAIN}&trace=1`, { as: 'control@mc.demo-city.example', token: t.body.token });
  assert.match(again.body.authorizationFlow[1].text, /already validated/, 'second call served from the resource server cache (4.5.2.2)');
});

test('[BIS-63] token carries the authorization server and the consumer id', async () => {
  const t = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: DRAIN }] } });
  assert.match(t.body.token, /^auth\.demo-city\.example\/control@mc\.demo-city\.example\/[0-9a-f]{64}$/);
});

test('[BIS-73][BIS-16] public items need no identity; protected items refuse anonymous callers', async () => {
  const pub = await c.req('GET', `/resource/v1/latest?id=${AQ}`);
  assert.equal(pub.status, 200);
  assert.ok('PM2_5' in pub.body);
  const anonTok = await c.req('POST', '/auth/v1/token', { body: { request: [{ id: DRAIN }] } });
  assert.equal(anonTok.status, 401);
});

test('[BIS-76][BIS-69] certificate class decides the label: class 2 is refused private data even when asked', async () => {
  const r = await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: [{ id: WASTE }] } });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /class 2 certificate cannot access private data; needs class 4 or 5/);
  const g = await c.req('POST', '/auth/v1/token', { as: 'planner@mc.demo-city.example', body: { request: [{ id: GRIEV }] } });
  assert.equal(g.status, 403);
  assert.match(g.body.error, /confidential data; needs class 5/);
});

test('[BIS-14][BIS-30][BIS-8][BIS-18][BIS-81] consent: request, provider notified, approve, then token', async () => {
  const first = await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: [{ id: FARE }], purpose: 'fare study' } });
  assert.equal(first.status, 403);
  const cid = first.body.denied[0].consent;
  assert.match(cid, /^CR-[0-9A-F]{8}$/);
  const mine = await c.req('GET', '/auth/v1/consent', { as: 'analyst@lab.example' });
  assert.equal(mine.body.find(x => x.id === cid).status, 'pending', 'consumer can see the status of its consent flow');
  const inbox = await c.req('GET', '/notify/v1/inbox', { as: 'officer@transport.demo-city.example' });
  assert.ok(inbox.body.notices.some(n => n.msg.includes(cid) && n.msg.includes('fare study')), 'provider told who asked and why');
  const other = await c.req('POST', '/auth/v1/consent/decide', { as: 'officer@wd.demo-city.example', body: { id: cid, approve: true } });
  assert.equal(other.status, 403, 'another provider cannot decide');
  const ok = await c.req('POST', '/auth/v1/consent/decide', { as: 'officer@transport.demo-city.example', body: { id: cid, approve: true } });
  assert.equal(ok.body.status, 'approved');
  const t = await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: [{ id: FARE }] } });
  assert.equal(t.status, 200);
  const d = await c.req('GET', `/resource/v1/search?id=${FARE}`, { as: 'analyst@lab.example', token: t.body.token });
  assert.equal(d.status, 200); assert.ok(d.body.total > 0);
});

test('[BIS-68] consent history is private to the provider of the resource', async () => {
  const wd = await c.req('GET', '/auth/v1/consent', { as: 'officer@wd.demo-city.example' });
  assert.ok(wd.body.every(x => !x.item_id.includes('fare')));
  const tr = await c.req('GET', '/auth/v1/consent', { as: 'officer@transport.demo-city.example' });
  assert.ok(tr.body.some(x => x.item_id === FARE));
});

test('[BIS-100][BIS-66] provider revokes access: token stops working and consumer leaves the policy', async () => {
  const t = await c.req('POST', '/auth/v1/token', { as: 'analyst@lab.example', body: { request: [{ id: FARE }] } });
  assert.equal(t.status, 200);
  assert.equal((await c.req('GET', `/resource/v1/count?id=${FARE}`, { as: 'analyst@lab.example', token: t.body.token })).status, 200);
  const rv = await c.req('POST', '/auth/v1/token/revoke', { as: 'officer@transport.demo-city.example', body: { id: FARE, consumer: 'analyst@lab.example' } });
  assert.equal(rv.status, 200); assert.ok(rv.body.revoked >= 1);
  const after_ = await c.req('GET', `/resource/v1/count?id=${FARE}`, { as: 'analyst@lab.example', token: t.body.token });
  assert.equal(after_.status, 403); assert.match(after_.body.error, /revoked/);
  const pol = await c.req('GET', `/auth/v1/acl?id=${FARE}`, { as: 'officer@transport.demo-city.example' });
  assert.ok(!pol.body.C.includes('analyst@lab.example'));
});

test('[BIS-35] consumer can revoke its own token; not someone else\'s', async () => {
  const t = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: DRAIN }] } });
  const bad = await c.req('POST', '/auth/v1/token/revoke', { as: 'planner@mc.demo-city.example', body: { tokens: [t.body.token] } });
  assert.equal(bad.status, 403);
  const ok = await c.req('POST', '/auth/v1/token/revoke', { as: 'control@mc.demo-city.example', body: { tokens: [t.body.token] } });
  assert.equal(ok.body.revoked, 1);
  const list = await c.req('GET', '/auth/v1/token/list', { as: 'control@mc.demo-city.example' });
  assert.ok(list.body.some(x => x.tail === t.body.token.slice(-8) && x.status === 'revoked'));
});

test('[BIS-57] only a class 1 resource server may introspect; it gets consumer, class and expiry', async () => {
  const t = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: DRAIN }] } });
  const byConsumer = await c.req('POST', '/auth/v1/token/introspect', { as: 'control@mc.demo-city.example', body: { token: t.body.token, id: DRAIN } });
  assert.equal(byConsumer.status, 403);
  const wrongRs = await c.req('POST', '/auth/v1/token/introspect', { as: 'admin@mc.demo-city.example', body: { token: t.body.token, id: DRAIN } });
  assert.equal(wrongRs.status, 403, 'rs1 does not serve drain items');
  const rs = await c.req('POST', '/auth/v1/token/introspect', { as: 'admin@wd.demo-city.example', body: { token: t.body.token, id: DRAIN } });
  assert.equal(rs.status, 200, JSON.stringify(rs.body));
  assert.equal(rs.body.consumer, 'control@mc.demo-city.example');
  assert.equal(rs.body['consumer-certificate-class'], 5);
  assert.ok(Date.parse(rs.body.expiry) > Date.now());
});

test('[BIS-18] a token is bound to the certificate it was issued to', async () => {
  const t = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: DRAIN }] } });
  const stolen = await c.req('GET', `/resource/v1/latest?id=${DRAIN}`, { as: 'planner@mc.demo-city.example', token: t.body.token });
  assert.equal(stolen.status, 403);
  const anon = await c.req('GET', `/resource/v1/latest?id=${DRAIN}`, { token: t.body.token });
  assert.equal(anon.status, 403);
});

test('[BIS-32][BIS-21] licence agreement lets an app developer in without separate consent', async () => {
  const before_ = await c.req('POST', '/auth/v1/token', { as: 'dev@apps.example', body: { request: [{ id: FARE }] } });
  assert.equal(before_.status, 403);
  const lic = await c.req('POST', '/auth/v1/licence', { as: 'officer@transport.demo-city.example', body: { id: FARE, app: 'Journey Planner (demo app)', developer: 'dev@apps.example', terms: 'Display fares only; no resale.' } });
  assert.equal(lic.status, 200);
  const t = await c.req('POST', '/auth/v1/token', { as: 'dev@apps.example', body: { request: [{ id: FARE }] } });
  assert.equal(t.status, 200); assert.match(t.body.via[0].via, /licence agreement for Journey Planner/);
  await c.req('DELETE', `/auth/v1/licence?id=${encodeURIComponent(FARE)}&app=${encodeURIComponent('Journey Planner (demo app)')}`, { as: 'officer@transport.demo-city.example' });
  const gone = await c.req('GET', `/resource/v1/count?id=${FARE}`, { as: 'dev@apps.example', token: t.body.token });
  assert.equal(gone.status, 403, 'ending the licence ends licence-based tokens');
});

test('[BIS-70][BIS-71][BIS-72][BIS-28] policy P = (C, A) with Table 3 values; bad values refused; label change resets A to Table 4 defaults', async () => {
  const p = await c.req('GET', `/auth/v1/acl?id=${WASTE}`, { as: 'officer@mc.demo-city.example' });
  assert.equal(p.body.label, 'private');
  // Table 4, Private column, as printed
  assert.equal(p.body.A.dataLocality, 'Configurable or as per regulatory framework');
  assert.equal(p.body.A.dataUsage, 'Licensed with legal framework'); assert.equal(p.body.A.dataAudit, 'Needs audit'); assert.equal(p.body.A.consent, 'Requires consent of owners');
  assert.match(p.body.text, /^P = \( C = \{.*planner@mc\.demo-city\.example.*class ∈ \{4,5\}/);
  const bad = await c.req('PUT', `/auth/v1/acl?id=${WASTE}`, { as: 'officer@mc.demo-city.example', body: { A: { dataLocality: 'Mars' } } });
  assert.equal(bad.status, 400);
  const notOwner = await c.req('PUT', `/auth/v1/acl?id=${WASTE}`, { as: 'officer@wd.demo-city.example', body: { A: { dataLocality: 'State' } } });
  assert.equal(notOwner.status, 403);
  const ch = await c.req('PUT', `/auth/v1/acl?id=${WASTE}`, { as: 'officer@mc.demo-city.example', body: { label: 'confidential' } });
  assert.equal(ch.status, 200);
  assert.equal(ch.body.A.authProtocol, 'Requires authorization using DX/UMA, custom auth policy specified in a policy language');
  assert.equal(ch.body.A.dataLocality, 'Only service based access'); assert.equal(ch.body.A.dataMonetization, 'NA');
  const t3 = await c.req('PUT', `/auth/v1/acl?id=${WASTE}`, { as: 'officer@mc.demo-city.example', body: { A: { authProtocol: 'Token/DX + Aperture policy language' } } });
  assert.equal(t3.status, 200, 'a Table 3 value can replace the Table 4 default');
  const planner = await c.req('POST', '/auth/v1/token', { as: 'planner@mc.demo-city.example', body: { request: [{ id: WASTE }] } });
  assert.equal(planner.status, 403, 'class 4 planner loses access when data becomes confidential');
  await c.req('PUT', `/auth/v1/acl?id=${WASTE}`, { as: 'officer@mc.demo-city.example', body: { label: 'private' } });
});

test('[BIS-80] provider has the list of all consent flows and data flows with status', async () => {
  const f = await c.req('GET', '/auth/v1/flows', { as: 'officer@transport.demo-city.example' });
  assert.equal(f.status, 200);
  assert.ok(f.body.consents.length >= 1);
  assert.ok(f.body.dataFlows.some(d => d.status === 'revoked'));
  assert.ok(f.body.dataFlows.every(d => typeof d.accesses === 'number'));
});

test('[BIS-83] authorization service down: consumer gets 503 and can retry later', async () => {
  const s = await c.login('admin');
  await s.as('POST', '/ops/v1/service', { body: { service: 'authorization', up: false } });
  const r = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: DRAIN }] } });
  assert.equal(r.status, 503);
  await s.as('POST', '/ops/v1/service', { body: { service: 'authorization', up: true } });
  const r2 = await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: DRAIN }] } });
  assert.equal(r2.status, 200);
});
