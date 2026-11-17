// BIS 4.5.2.1 (BIS-111): "the DX framework shall support technologies such as trusted execution environments for
// policy enforcement at the time of data use". A provider limits an item to attested enclaves; a token for it needs an
// attestation signed by a verifier the DX administrator registered; the data then comes back sealed to the enclave key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startCity } from './helpers.js';
import { openSealed } from '../src/dx/tee.js';

const ITEM = 'urn:demo-cat:drains/drain-4', CONSUMER = 'control@mc.demo-city.example', OWNER = 'officer@wd.demo-city.example';
const GOOD = crypto.createHash('sha256').update('enclave image v1').digest('hex'), OTHER = crypto.createHash('sha256').update('something else').digest('hex');
const verifier = crypto.generateKeyPairSync('ed25519'), enclave = crypto.generateKeyPairSync('x25519');
const pem = k => k.export({ type: 'spki', format: 'pem' });
let c, vid;
const attest = (over = {}, key = verifier.privateKey) => {
  const report = Buffer.from(JSON.stringify({ measurement: GOOD, enclavePublicKey: pem(enclave.publicKey), consumer: CONSUMER, issuedAt: new Date().toISOString(), ...over }));
  return { verifier: vid, report: report.toString('base64url'), signature: crypto.sign(null, report, key).toString('base64url') };
};
const token = body => c.req('POST', '/auth/v1/token', { as: CONSUMER, body: { request: [{ id: ITEM }], ...body } });

before(async () => { c = await startCity(); });
after(async () => { await c.stop(); });

test('[BIS-111] only the administrator registers an attestation verifier; only the owner limits an item to enclaves', async () => {
  const admin = await c.login('admin');
  assert.equal((await c.req('POST', '/auth/v1/tee/verifiers', { as: OWNER, body: { name: 'City attestation service', publicKeyPem: pem(verifier.publicKey) } })).status, 403);
  const v = await admin.as('POST', '/auth/v1/tee/verifiers', { body: { name: 'City attestation service', publicKeyPem: pem(verifier.publicKey) } });
  assert.equal(v.status, 201, JSON.stringify(v.body)); vid = v.body.id;
  assert.equal((await admin.as('POST', '/auth/v1/tee/verifiers', { body: { name: 'wrong kind', publicKeyPem: pem(enclave.publicKey) } })).status, 400, 'an X25519 key is not a signing key');
  assert.equal((await c.req('POST', '/auth/v1/tee/requirement', { as: CONSUMER, body: { id: ITEM, measurements: [GOOD] } })).status, 403, 'not the owner');
  assert.equal((await c.req('POST', '/auth/v1/tee/requirement', { as: 'officer@pcc.demo-city.example', body: { id: 'urn:demo-cat:aqm/aqm-2', measurements: [GOOD] } })).status, 400, 'public items cannot be limited');
  const r = await c.req('POST', '/auth/v1/tee/requirement', { as: OWNER, body: { id: ITEM, measurements: [GOOD] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual((await c.req('GET', '/auth/v1/tee/requirement?id=' + ITEM)).body.measurements, [GOOD]);
});

test('[BIS-111] a token needs a fresh attestation of an accepted enclave, signed by a registered verifier', async () => {
  assert.equal((await token({})).status, 403, 'no attestation');
  assert.equal((await token({ attestation: attest({}, crypto.generateKeyPairSync('ed25519').privateKey) })).status, 403, 'signed by someone else');
  assert.equal((await token({ attestation: attest({ measurement: OTHER }) })).status, 403, 'measurement not accepted by the provider');
  assert.equal((await token({ attestation: attest({ consumer: 'analyst@lab.example' }) })).status, 403, 'made for another consumer');
  assert.equal((await token({ attestation: attest({ issuedAt: new Date(Date.now() - 3600e3).toISOString() }) })).status, 403, 'too old');
  const t = await token({ attestation: attest() });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body.enclave.measurement, GOOD);
});

test('[BIS-111] at the time of use the data is sealed to the enclave key; plain paths are refused', async () => {
  const tk = (await token({ attestation: attest() })).body.token;
  const r = await c.req('GET', '/resource/v1/latest?id=' + ITEM, { as: CONSUMER, token: tk });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.enclaveMeasurement, GOOD);
  assert.equal(r.body.sealed.alg, 'X25519-HKDF-SHA256-A256GCM');
  assert.ok(!('level' in r.body) && !JSON.stringify(r.body).includes('observationDateTime'), 'no plain data in the answer');
  const plain = openSealed(enclave.privateKey, r.body.sealed); // what the enclave can do, and nobody else
  assert.equal(plain.id, ITEM);
  assert.ok(plain.observationDateTime);
  assert.throws(() => openSealed(crypto.generateKeyPairSync('x25519').privateKey, r.body.sealed), 'another key cannot open it');
  const sub = await c.req('POST', '/resource/v1/subscription', { as: CONSUMER, token: tk, body: { id: ITEM, every: 5 } });
  assert.equal(sub.status, 403, 'a subscription would hand out plain data');
  // a token from before the rule, or one without an enclave, is refused
  const tok2 = (await c.req('POST', '/auth/v1/token', { as: CONSUMER, body: { request: [{ id: 'urn:demo-cat:drains/drain-3' }] } })).body.token;
  assert.equal((await c.req('GET', '/resource/v1/latest?id=urn:demo-cat:drains/drain-3', { as: CONSUMER, token: tok2 })).status, 200, 'items without the rule are unchanged');
  const audit = c.app.db.prepare("SELECT action, detail FROM audit WHERE detail LIKE ?").all('%' + ITEM + '%').map(r => r.action);
  assert.ok(audit.includes('Enclave rule set') && audit.some(a => /sealed to enclave/.test(a)), audit.join(' | '));
  assert.equal(c.app.audit.verify().ok, true);
});

test('[BIS-111] removing a verifier stops new tokens; removing the rule gives plain answers again', async () => {
  const admin = await c.login('admin');
  assert.equal((await admin.as('POST', '/auth/v1/tee/verifiers/remove', { body: { id: vid } })).status, 200);
  assert.equal((await token({ attestation: attest() })).status, 403);
  await c.req('POST', '/auth/v1/tee/requirement', { as: OWNER, body: { id: ITEM, measurements: [] } });
  const tk = (await token({})).body.token;
  const r = await c.req('GET', '/resource/v1/latest?id=' + ITEM, { as: CONSUMER, token: tk });
  assert.equal(r.status, 200); assert.ok(!r.body.sealed);
});
