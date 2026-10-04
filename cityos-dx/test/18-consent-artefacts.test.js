// Consent artefacts (BIS 4.1 principle 6 with reference [b.2]; BIS 4.3): a signed artefact is written when a
// provider approves consent, its token is what updates the access control policy, and expiry or revocation ends access.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startCity } from './helpers.js';

let c;
before(async () => { c = await startCity(); });
after(async () => { await c.stop(); });

const FARE = 'urn:demo-cat:fare/fare-revenue';
const PROVIDER = 'officer@transport.demo-city.example', CONSUMER = 'analyst@lab.example';
let artId, artToken;

test('[BIS-118] approving consent writes a signed consent artefact in the layout of the MeitY consent framework', async () => {
  const first = await c.req('POST', '/auth/v1/token', { as: CONSUMER, body: { request: [{ id: FARE }], purpose: 'fare study' } });
  const cid = first.body.denied[0].consent;
  assert.equal((await c.req('POST', '/auth/v1/consent/decide', { as: PROVIDER, body: { id: cid, approve: true, validDays: 0 } })).status, 400, 'validity is checked');
  assert.equal((await c.req('POST', '/auth/v1/consent/decide', { as: PROVIDER, body: { id: cid, approve: true, access: 'SELL' } })).status, 400, 'permission is checked');
  const ok = await c.req('POST', '/auth/v1/consent/decide', { as: PROVIDER, body: { id: cid, approve: true, validDays: 30, access: 'QUERY' } });
  assert.equal(ok.body.status, 'approved', JSON.stringify(ok.body));
  const mine = await c.req('GET', '/auth/v1/consent', { as: CONSUMER });
  const row = mine.body.find(x => x.id === cid);
  assert.match(row.artefact.id, /^CA-[0-9A-F]{12}$/); assert.equal(row.artefact.status, 'active');
  artId = row.artefact.id;
  const a = await c.req('GET', '/auth/v1/consent/artefact?id=' + artId, { as: CONSUMER });
  assert.equal(a.status, 200);
  const art = a.body.artefact;
  for (const k of ['ver', 'txnid', 'consentId', 'timestamp', 'DataConsumer', 'DataProvider', 'Purpose', 'User', 'Data', 'Permission', 'ConsentUse']) assert.ok(k in art, k);
  assert.equal(art.consentId, artId); assert.equal(art.DataConsumer.id, CONSUMER); assert.equal(art.Data.id, FARE);
  assert.equal(art.Purpose.text, 'fare study'); assert.equal(art.Permission.access, 'QUERY'); assert.equal(art.Permission.dataLife.value, 30);
  assert.equal(Date.parse(art.Permission.dateRange.to) - Date.parse(art.Permission.dateRange.from), 30 * 86400e3);
  // the token is a JWS signed with the DX key; anyone can check it with the public key
  artToken = a.body.token;
  const key = (await c.req('GET', '/auth/v1/consent/artefact/public-key')).body;
  const [h, b, s] = artToken.split('.');
  assert.ok(crypto.verify(null, Buffer.from(h + '.' + b), crypto.createPublicKey(key.publicKeyPem), Buffer.from(s, 'base64url')));
  const v = await c.req('POST', '/auth/v1/consent/artefact/verify', { body: { token: artToken } });
  assert.equal(v.body.valid, true); assert.equal(v.body.status, 'active');
  const forged = b.slice(0, -2) + (b.endsWith('A') ? 'B' : 'A');
  assert.equal((await c.req('POST', '/auth/v1/consent/artefact/verify', { body: { token: `${h}.${forged}.${s}` } })).body.valid, false, 'a changed artefact fails');
  // the artefact is private to the consumer, the provider and the auditor
  assert.equal((await c.req('GET', '/auth/v1/consent/artefact?id=' + artId, { as: PROVIDER })).status, 200);
  assert.equal((await c.req('GET', '/auth/v1/consent/artefact?id=' + artId, { as: 'officer@wd.demo-city.example' })).status, 403);
  const auditor = await c.login('auditor');
  assert.equal((await auditor.as('GET', '/auth/v1/consent/artefact?id=' + artId)).status, 200);
});

test('[BIS-125] the consent token updates the access control policy and this is logged; tokens never outlive the consent', async () => {
  const admin = await c.login('admin');
  const log = (await admin.as('GET', '/ops/v1/audit?iface=Authorization&limit=200')).body;
  assert.ok(log.some(e => e.action === 'Access control policy updated with consent token' && e.detail.includes(artId) && e.detail.includes(CONSUMER)));
  assert.ok(c.app.catalogue.get(FARE).policy.C.includes(CONSUMER), 'consumer is on the policy');
  const t = await c.req('POST', '/auth/v1/token', { as: CONSUMER, body: { request: [{ id: FARE }] } });
  assert.equal(t.status, 200);
  assert.match(t.body.via[0].via, new RegExp(artId));
  // use is counted in the artefact (ConsentUse)
  assert.equal((await c.req('GET', '/auth/v1/consent/artefact?id=' + artId, { as: CONSUMER })).body.artefact.ConsentUse.count, 1);
  // the consent ends: the consumer is taken off the policy and a new consent request is needed
  c.app.db.prepare('UPDATE consent_artefacts SET valid_to=? WHERE id=?').run(Date.now() + 5000, artId);
  const short = await c.req('POST', '/auth/v1/token', { as: CONSUMER, body: { request: [{ id: FARE }] } });
  assert.ok(short.body['expires-in'] <= 5, 'token capped at the end of the consent');
  c.app.db.prepare('UPDATE consent_artefacts SET valid_to=? WHERE id=?').run(Date.now() - 1000, artId);
  const late = await c.req('POST', '/auth/v1/token', { as: CONSUMER, body: { request: [{ id: FARE }] } });
  assert.equal(late.status, 403); assert.ok(late.body.denied[0].consent, 'a new consent request was raised');
  assert.equal((await c.req('POST', '/auth/v1/consent/artefact/verify', { body: { token: artToken } })).body.status, 'expired');
  const log2 = (await admin.as('GET', '/ops/v1/audit?iface=Authorization&limit=200')).body;
  assert.ok(log2.some(e => e.action === 'Access control policy updated: consent ended' && e.detail.includes(artId)));
});

test('[BIS-118][BIS-125] revoking access revokes the artefact', async () => {
  const cid = (await c.req('GET', '/auth/v1/consent', { as: CONSUMER })).body.find(x => x.status === 'pending').id;
  await c.req('POST', '/auth/v1/consent/decide', { as: PROVIDER, body: { id: cid, approve: true } });
  const art = (await c.req('GET', '/auth/v1/consent', { as: CONSUMER })).body.find(x => x.id === cid).artefact;
  assert.equal(art.status, 'active');
  const tok = (await c.req('GET', '/auth/v1/consent/artefact?id=' + art.id, { as: CONSUMER })).body.token;
  assert.equal((await c.req('POST', '/auth/v1/token/revoke', { as: PROVIDER, body: { id: FARE, consumer: CONSUMER } })).status, 200);
  assert.equal((await c.req('POST', '/auth/v1/consent/artefact/verify', { body: { token: tok } })).body.status, 'revoked');
  assert.equal((await c.req('POST', '/auth/v1/token', { as: CONSUMER, body: { request: [{ id: FARE }] } })).status, 403);
});
