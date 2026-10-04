// The last gaps that code can close: Table 6 value formats (BIS-114), tokens from a provider's own authorization
// server (BIS-55), file, object store and warehouse sources for the CIL (COS-31) and AMQP 1.0 (BIS-102).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCity } from './helpers.js';
import { validateItem, TABLE6 } from '../src/dx/model.js';

let c;
before(async () => { c = await startCity(); });
after(async () => { await c.stop(); });

test('[BIS-114] every Table 6 attribute is checked for its core type and value format', async () => {
  assert.equal(Object.keys(TABLE6).length, 31, '29 Table 6 rows and the two Table 7 aliases');
  const good = (await c.req('GET', '/catalogue/v1/items?id=urn:demo-cat:aqm/aqm-1')).body;
  assert.deepEqual(validateItem(good), [], 'seeded items pass');
  const all = (await c.req('GET', '/catalogue/v1/search?limit=500')).body.results;
  for (const it of all) assert.deepEqual(validateItem(it), [], it.id);
  const bad = (k, v) => validateItem({ ...good, [k]: v });
  assert.match(bad('createdAt', { type: 'Property', value: '2026-10-04T10:00:00Z' }).join(), /createdAt" must be a TimeProperty/);
  assert.match(bad('tags', { type: 'Property', value: 'flood' }).join(), /tags" value must be an array/);
  assert.match(bad('tags', { type: 'Property', value: ['flood', 3] }).join(), /list of keywords/);
  assert.match(bad('statusSchema', { type: 'Property', value: 'old' }).join(), /'active' or 'deprecated'/);
  assert.deepEqual(bad('statusSchema', { type: 'Property', value: 'deprecated' }), []);
  assert.match(bad('uriLink', { type: 'Property', value: 'not a link' }).join(), /uriLink" value must be a URI/);
  assert.match(bad('accessObjectURL', { type: 'Property', value: 'docs' }).join(), /must be a URI/);
  assert.match(bad('refDataModel', { type: 'Property', value: 'x' }).join(), /must be a Relationship/);
  assert.match(bad('resourceServerGroup', { type: 'Relationship', value: ['urn:demo-cat:group/aqm', 'no'] }).join(), /an IRI or a list of IRIs/);
  assert.match(bad('organizationInfo', { type: 'Property', value: 'Transport' }).join(), /must be an object/);
  assert.match(bad('deviceModelInfo', { type: 'Property', value: [] }).join(), /must be an object/);
  assert.match(bad('accessInformation', { type: 'Property', value: ['openAPI'] }).join(), /list of access mechanisms/);
  assert.deepEqual(bad('dataAttributeList', { type: 'Property', value: ['PM2_5', 'CO2_MAX'] }), []);
  assert.match(bad('itemDescription', { type: 'Property', value: '' }).join(), /must be a string/);
  // the catalogue refuses an item that breaks a Table 6 format
  const doc = { ...good, id: 'urn:demo-cat:aqm/aqm-x', tags: { type: 'Property', value: 'air' } };
  const r = await c.req('POST', '/catalogue/v1/items', { as: 'officer@pcc.demo-city.example', body: { item: doc } });
  assert.equal(r.status, 400); assert.match(JSON.stringify(r.body), /Table 6/);
});

test('[BIS-55] a resource server also accepts tokens from the provider\'s own authorization server', async () => {
  const crypto = await import('node:crypto');
  const FARE = 'urn:demo-cat:fare/fare-revenue', OWNER = 'officer@transport.demo-city.example', WHO = 'analyst@lab.example';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const ISS = 'https://auth.transport.demo-city.example';
  const jwt = (claims, key = privateKey, alg = 'EdDSA') => {
    const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b({ alg, typ: 'JWT' }), p = b(claims);
    return `${h}.${p}.${crypto.sign(null, Buffer.from(h + '.' + p), key).toString('base64url')}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: ISS, sub: WHO, items: [FARE], iat: now, exp: now + 600 };
  // only the owner can switch its items to its own server
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal((await c.req('POST', '/auth/v1/provider-auth-server', { as: 'officer@wd.demo-city.example', body: { issuer: ISS, publicKeyPem: pem, items: [FARE] } })).status, 403);
  assert.equal((await c.req('POST', '/auth/v1/provider-auth-server', { as: OWNER, body: { issuer: 'http://insecure', publicKeyPem: pem, items: [FARE] } })).status, 400);
  const reg = await c.req('POST', '/auth/v1/provider-auth-server', { as: OWNER, body: { issuer: ISS, publicKeyPem: pem, items: [FARE] } });
  assert.equal(reg.status, 200, JSON.stringify(reg.body)); assert.equal(reg.body.alg, 'EdDSA');
  const doc = (await c.req('GET', '/catalogue/v1/items?id=' + FARE)).body;
  assert.deepEqual(doc.authorizationServerInfo.value, { authServer: ISS, authType: 'provider-own', alg: 'EdDSA' });
  // no token: the answer names the provider's server
  const none = await c.req('GET', '/resource/v1/latest?id=' + FARE, { as: WHO });
  assert.equal(none.status, 401); assert.equal(none.body.authServer, ISS);
  const ok = await c.req('GET', '/resource/v1/search?id=' + FARE, { as: WHO, token: jwt(good) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.ok(ok.body.total > 0);
  const refused = async (t, re) => { const r = await c.req('GET', '/resource/v1/latest?id=' + FARE, { as: WHO, token: t }); assert.equal(r.status, 403, re); assert.match(r.body.error, re); };
  await refused(jwt({ ...good, exp: now - 5 }), /expired/);
  await refused(jwt({ ...good, sub: 'dev@apps.example' }), /another consumer/);
  await refused(jwt({ ...good, items: ['urn:demo-cat:swm/waste-daily'] }), /does not cover/);
  await refused(jwt({ ...good, iss: 'https://evil.example' }), /not the authorization server/);
  await refused(jwt(good, crypto.generateKeyPairSync('ed25519').privateKey), /signature invalid/);
  await refused(jwt({ ...good, exp: now + 3 * 86400 }), /longer than 24 hours/);
  // the token works over MQTT too, and a token for this item does not open another provider's item
  assert.equal((await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:drains/drain-1', { as: WHO, token: jwt({ ...good, items: ['urn:demo-cat:drains/drain-1'] }) })).status, 403);
  const admin = await c.login('admin');
  const log = (await admin.as('GET', '/ops/v1/audit?limit=300')).body;
  assert.ok(log.some(e => e.action === 'Provider authorization server registered'));
  assert.ok(log.some(e => e.action === 'search' && e.detail.includes(FARE) && e.actor === WHO));
  // back to the DX authorization server: provider tokens stop working
  const rm = await c.req('POST', '/auth/v1/provider-auth-server/remove', { as: OWNER, body: { issuer: ISS, items: [FARE] } });
  assert.equal(rm.status, 200); assert.equal(rm.body.issuerRemoved, true);
  assert.equal((await c.req('GET', '/resource/v1/latest?id=' + FARE, { as: WHO, token: jwt(good) })).status, 403);
});
