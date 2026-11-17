// Trusted execution environments for policy enforcement at the time of data use (BIS 4.5.2.1, last paragraph:
// "the DX framework shall support technologies such as trusted execution environments for policy enforcement at the
// time of data use").
//
// How it works here:
//  1. The DX administrator registers an attestation verifier the city trusts (its Ed25519 public key). The verifier is
//     the service that checks the enclave's hardware quote (for example a cloud provider's attestation service for
//     Intel TDX/SGX or AMD SEV-SNP). This server does not parse hardware quotes itself.
//  2. A provider marks one of its non-public items "use only inside an enclave" and lists the enclave code
//     measurements (SHA-256) it accepts.
//  3. A consumer asking for a token for such an item sends an attestation report signed by a registered verifier:
//     the enclave's measurement, the enclave's X25519 public key, the consumer and the time. The token is bound to that
//     enclave.
//  4. At the time of use, the resource server returns the data sealed (encrypted) to the enclave's key, so only code
//     with the accepted measurement can read it. Streams, subscriptions and media of such items are refused, because
//     they would hand out plain data.
import crypto from 'node:crypto';
import { q } from '../db.js';
import { iso, need, randHex } from '../util.js';
import { actorOf } from '../identity/identity.js';

const b64u = b => Buffer.from(b).toString('base64url');
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_AGE_MS = 10 * 60e3;
export const SEAL_ALG = 'X25519-HKDF-SHA256-A256GCM';

export function makeTee(db, audit, catalogue) {
  q.run(db, `CREATE TABLE IF NOT EXISTS tee_verifiers (id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL, removed_at TEXT)`);
  q.run(db, `CREATE TABLE IF NOT EXISTS tee_items (item_id TEXT PRIMARY KEY, measurements TEXT NOT NULL, set_by TEXT NOT NULL, set_at TEXT NOT NULL)`);
  q.run(db, `CREATE TABLE IF NOT EXISTS token_tee (hash TEXT PRIMARY KEY, measurement TEXT NOT NULL, enclave_key TEXT NOT NULL, verifier TEXT NOT NULL)`);

  const api = {
    // ---- administrator: trusted attestation verifiers ----
    addVerifier(p, { name, publicKeyPem }) {
      need(p.role === 'admin', p.role === 'anonymous' ? 401 : 403, 'only the DX administrator may register an attestation verifier');
      need(typeof name === 'string' && name.trim().length >= 3, 400, 'name: at least 3 characters');
      let key; try { key = crypto.createPublicKey(String(publicKeyPem || '')); } catch { need(false, 400, 'publicKeyPem must be a PEM public key'); }
      need(key.asymmetricKeyType === 'ed25519', 400, 'the verifier key must be Ed25519');
      const id = 'TV-' + randHex(4).toUpperCase();
      q.run(db, 'INSERT INTO tee_verifiers (id, name, public_key, added_by, added_at) VALUES (?,?,?,?,?)', id, name.trim().slice(0, 120), key.export({ type: 'spki', format: 'pem' }), actorOf(p), iso(Date.now()));
      audit.log('Authorization', actorOf(p), 'TEE verifier added', `${id} ${name.trim()}`);
      return { id, name: name.trim() };
    },
    removeVerifier(p, { id }) {
      need(p.role === 'admin', p.role === 'anonymous' ? 401 : 403, 'only the DX administrator may remove an attestation verifier');
      const r = q.run(db, 'UPDATE tee_verifiers SET removed_at=? WHERE id=? AND removed_at IS NULL', iso(Date.now()), String(id || ''));
      need(r.changes, 404, 'no such active verifier');
      audit.log('Authorization', actorOf(p), 'TEE verifier removed', String(id));
      return { removed: id };
    },
    verifiers() { return q.all(db, 'SELECT id, name, added_by, added_at, removed_at FROM tee_verifiers ORDER BY added_at'); },

    // ---- provider: which items may be used only inside an attested enclave ----
    setRequirement(p, { id, measurements }) {
      const it = catalogue.get(String(id || '')); need(it && it.item_type === 'resourceItem', 404, 'no such resource item');
      catalogue.assertOwner(it, p, 'set the enclave rule of');
      need(Array.isArray(measurements) && measurements.length <= 20, 400, 'measurements must be a list of up to 20 SHA-256 values (64 hex characters); an empty list removes the rule');
      const ms = [...new Set(measurements.map(m => String(m).toLowerCase()))];
      need(ms.every(m => HEX64.test(m)), 400, 'each measurement must be 64 hex characters (SHA-256)');
      if (!ms.length) { q.run(db, 'DELETE FROM tee_items WHERE item_id=?', it.id); audit.log('Authorization', actorOf(p), 'Enclave rule removed', it.id); return { id: it.id, teeRequired: false }; }
      need(it.policy.label !== 'public', 400, 'a public item cannot be limited to enclaves; change its label first');
      q.run(db, 'INSERT OR REPLACE INTO tee_items (item_id, measurements, set_by, set_at) VALUES (?,?,?,?)', it.id, JSON.stringify(ms), actorOf(p), iso(Date.now()));
      audit.log('Authorization', actorOf(p), 'Enclave rule set', `${it.id}: ${ms.length} accepted measurement(s)`);
      return { id: it.id, teeRequired: true, measurements: ms };
    },
    requirement(itemId) { const r = q.get(db, 'SELECT measurements FROM tee_items WHERE item_id=?', itemId); return r ? { measurements: JSON.parse(r.measurements) } : null; },

    // ---- token time: check the attestation for the items that need an enclave ----
    // attestation = { verifier, report (base64url of the JSON report), signature (base64url Ed25519 over the report bytes) }
    // report = { measurement, enclavePublicKey (X25519 PEM), consumer, issuedAt (ISO 8601) }
    check(p, attestation, items) {
      const ruled = items.map(it => [it, api.requirement(it.id)]).filter(([, r]) => r);
      if (!ruled.length) return null;
      need(attestation && typeof attestation === 'object', 403, `${ruled.map(([it]) => it.id).join(', ')} may be used only inside an attested enclave: send an attestation report signed by a registered verifier (BIS 4.5.2.1)`);
      const v = q.get(db, 'SELECT * FROM tee_verifiers WHERE id=? AND removed_at IS NULL', String(attestation.verifier || ''));
      need(v, 403, 'the attestation verifier is not registered with this data exchange');
      const raw = Buffer.from(String(attestation.report || ''), 'base64url');
      let ok = false; try { ok = crypto.verify(null, raw, crypto.createPublicKey(v.public_key), Buffer.from(String(attestation.signature || ''), 'base64url')); } catch { ok = false; }
      need(ok, 403, 'the attestation signature does not verify');
      let rep; try { rep = JSON.parse(raw.toString('utf8')); } catch { need(false, 403, 'the attestation report is not JSON'); }
      need(rep.consumer === p.email, 403, 'the attestation was made for another consumer');
      const age = Date.now() - Date.parse(rep.issuedAt);
      need(Number.isFinite(age) && age >= -60e3 && age <= MAX_AGE_MS, 403, 'the attestation is older than 10 minutes or from the future');
      const m = String(rep.measurement || '').toLowerCase(); need(HEX64.test(m), 403, 'the attestation has no valid measurement');
      for (const [it, r] of ruled) need(r.measurements.includes(m), 403, `enclave measurement ${m.slice(0, 12)}… is not accepted by the provider of ${it.id}`);
      let key; try { key = crypto.createPublicKey(String(rep.enclavePublicKey || '')); } catch { need(false, 403, 'the attestation has no enclave public key'); }
      need(key.asymmetricKeyType === 'x25519', 403, 'the enclave key must be X25519');
      return { measurement: m, enclaveKey: key.export({ type: 'spki', format: 'pem' }), verifier: v.id };
    },
    bind(hash, att) { q.run(db, 'INSERT OR REPLACE INTO token_tee (hash, measurement, enclave_key, verifier) VALUES (?,?,?,?)', hash, att.measurement, att.enclaveKey, att.verifier); },
    bound(hash) { return q.get(db, 'SELECT * FROM token_tee WHERE hash=?', hash) || null; },

    // ---- time of use: seal the answer to the enclave key ----
    seal(enclaveKeyPem, obj) {
      const eph = crypto.generateKeyPairSync('x25519');
      const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: crypto.createPublicKey(enclaveKeyPem) });
      const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('dx-tee-seal v1'), 32));
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
      return { alg: SEAL_ALG, epk: eph.publicKey.export({ type: 'spki', format: 'pem' }), iv: b64u(iv), ct: b64u(ct), tag: b64u(c.getAuthTag()) };
    },
  };
  return api;
}

// What an enclave does with a sealed answer (used by the tests and shown on the developer notes).
export function openSealed(enclavePrivateKey, s) {
  const shared = crypto.diffieHellman({ privateKey: enclavePrivateKey, publicKey: crypto.createPublicKey(s.epk) });
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('dx-tee-seal v1'), 32));
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64url')); d.setAuthTag(Buffer.from(s.tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(s.ct, 'base64url')), d.final()]).toString('utf8'));
}
