// Consent artefacts (BIS 4.1 principle 6 and 4.3; reference [b.2], MeitY Electronic Consent Framework).
// When a provider approves a consent request, the DX writes a consent artefact: who may use which data, for what
// purpose, with which permission, from when to when. The field layout follows the consent artefact of [b.2] as we
// read it (ver, txnid, consentId, DataConsumer, DataProvider, Purpose, User, Data, Permission, ConsentUse); it has
// not been checked against a certified consent manager.
// The artefact is signed by the DX (Ed25519, as a compact JWS). That signed token is what updates the item's
// access control policy (BIS 4.3): the policy changes only after the token is verified, and the change is logged.
// When the artefact expires or is revoked, the consumer is taken off the policy again.
import crypto from 'node:crypto';
import { q, tx } from '../db.js';
import { iso, need, randHex } from '../util.js';
import { actorOf } from '../identity/identity.js';

export const CONSENT_ACCESS = ['VIEW', 'STORE', 'QUERY', 'STREAM'];
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

export function makeConsentArtefacts({ db, cfg, audit, catalogue, keyPem }) {
  const priv = crypto.createPrivateKey(keyPem);
  const pub = crypto.createPublicKey(priv);
  const publicKeyPem = pub.export({ type: 'spki', format: 'pem' });
  const keyId = crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);

  function sign(artefact) {
    const head = b64({ alg: 'EdDSA', typ: 'consent-artefact+jws', kid: keyId });
    const body = b64(artefact);
    return `${head}.${body}.${crypto.sign(null, Buffer.from(head + '.' + body), priv).toString('base64url')}`;
  }

  // Checks the signature and the DX record. Returns { ok, artefact, status, reason }.
  function verify(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return { ok: false, reason: 'not a consent artefact token' };
    let head, artefact;
    try { head = JSON.parse(Buffer.from(parts[0], 'base64url')); artefact = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { return { ok: false, reason: 'not a consent artefact token' }; }
    if (head.alg !== 'EdDSA' || head.kid !== keyId) return { ok: false, reason: 'not signed by this DX' };
    if (!crypto.verify(null, Buffer.from(parts[0] + '.' + parts[1]), pub, Buffer.from(parts[2], 'base64url'))) return { ok: false, reason: 'signature invalid' };
    const row = q.get(db, 'SELECT * FROM consent_artefacts WHERE id=?', artefact.consentId);
    if (!row) return { ok: false, artefact, reason: 'unknown consent artefact' };
    const status = statusOf(row);
    return { ok: status === 'active', artefact, status, reason: status === 'active' ? null : 'consent artefact is ' + status };
  }

  const statusOf = r => (r.status === 'revoked' ? 'revoked' : r.valid_to < Date.now() ? 'expired' : 'active');
  const view = r => r && ({ id: r.id, consentRequest: r.consent_id, consumer: r.consumer, item: r.item_id, status: statusOf(r), validTo: iso(r.valid_to), createdAt: r.created_at, revokedAt: r.revoked_at,
    artefact: { ...JSON.parse(r.artefact), ConsentUse: { logUri: `https://${cfg.publicName}/ops/v1/audit?iface=Consent`, count: r.uses, lastUseDateTime: r.last_use } }, token: r.token });

  const api = {
    publicKeyPem, keyId, verify,
    // Provider approves: write and sign the artefact, then use its token to update the policy.
    create(consent, it, p, { validDays = 90, access = 'VIEW' } = {}) {
      const days = Number(validDays);
      need(Number.isFinite(days) && days >= 1 && days <= 365, 400, 'validDays must be between 1 and 365');
      need(CONSENT_ACCESS.includes(access), 400, `access must be one of: ${CONSENT_ACCESS.join(', ')}`);
      const now = Date.now(), to = now + days * 86400e3;
      const prov = it.doc.provider && catalogue.doc(it.doc.provider.value);
      const id = 'CA-' + randHex(6).toUpperCase();
      const artefact = {
        ver: '1.1', txnid: crypto.randomUUID(), consentId: id, timestamp: iso(now),
        DataConsumer: { id: consent.consumer, type: 'certificate holder', orgId: consent.org || null, class: consent.cls },
        DataProvider: { id: it.doc.provider?.value || null, name: prov?.name?.value || null, approvedBy: actorOf(p) },
        Purpose: { text: consent.purpose, consentRequest: consent.id },
        User: { idType: 'email', idNumber: consent.consumer },
        Data: { id: it.id, type: it.doc.resourceType?.value || 'resourceItem', accessPolicyLabel: it.policy.label },
        Permission: { access, dateRange: { from: iso(now), to: iso(to) }, frequency: { unit: 'TOKEN', value: 1, repeats: 0 }, dataLife: { unit: 'DAY', value: days }, duties: it.policy.A },
        Revoker: { id: it.doc.provider?.value || null },
      };
      const token = sign(artefact);
      q.run(db, 'INSERT INTO consent_artefacts (id, consent_id, consumer, item_id, valid_to, artefact, token, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        id, consent.id, consent.consumer, it.id, to, JSON.stringify(artefact), token, 'active', iso(now));
      audit.log('Consent', actorOf(p), 'Consent artefact signed', `${id} for ${consent.id}: ${consent.consumer} -> ${it.id}, ${access}, until ${iso(to)}`);
      api.applyToken(token, p);
      return id;
    },
    // BIS 4.3: the authorization token updates the access control policy, and this is logged.
    applyToken(token, p) {
      const v = verify(token);
      need(v.ok, 403, 'policy not updated: ' + v.reason);
      const it = catalogue.get(v.artefact.Data.id); need(it, 404, 'item no longer exists');
      const pol = it.policy, who = v.artefact.DataConsumer.id;
      if (!pol.C.includes(who)) q.run(db, 'UPDATE items SET policy=? WHERE id=?', JSON.stringify({ ...pol, C: [...pol.C, who], version: pol.version + 1 }), it.id);
      audit.log('Authorization', actorOf(p), 'Access control policy updated with consent token', `${it.id}: ${who} added (artefact ${v.artefact.consentId}, token …${String(token).slice(-8)})`);
      return v.artefact;
    },
    // The latest artefact of a consumer for an item; an expired one takes the consumer off the policy.
    check(consumer, it) {
      const r = q.get(db, 'SELECT * FROM consent_artefacts WHERE consumer=? AND item_id=? ORDER BY created_at DESC LIMIT 1', consumer, it.id);
      if (!r) return null;
      const status = statusOf(r);
      if (status !== 'active' && it.policy.C.includes(consumer)) {
        tx(db, () => {
          q.run(db, 'UPDATE items SET policy=? WHERE id=?', JSON.stringify({ ...it.policy, C: it.policy.C.filter(c => c !== consumer), version: it.policy.version + 1 }), it.id);
          if (r.status === 'active') q.run(db, "UPDATE consent_artefacts SET status='expired' WHERE id=?", r.id);
          q.run(db, "UPDATE consents SET status='expired' WHERE id=? AND status='approved'", r.consent_id);
        });
        audit.log('Authorization', 'Data Exchange', 'Access control policy updated: consent ended', `${it.id}: ${consumer} removed (artefact ${r.id} ${status})`);
        it.policy = catalogue.get(it.id).policy;
      }
      return { id: r.id, status, validTo: r.valid_to };
    },
    used(consumer, itemIds) {
      for (const id of itemIds) q.run(db, "UPDATE consent_artefacts SET uses=uses+1, last_use=? WHERE id=(SELECT id FROM consent_artefacts WHERE consumer=? AND item_id=? AND status='active' ORDER BY created_at DESC LIMIT 1)", iso(Date.now()), consumer, id);
    },
    revoke(consumer, itemId, by) {
      const n = q.run(db, "UPDATE consent_artefacts SET status='revoked', revoked_at=? WHERE consumer=? AND item_id=? AND status='active'", iso(Date.now()), consumer, itemId).changes;
      if (n) audit.log('Consent', actorOf(by), 'Consent artefact revoked', `${consumer} -> ${itemId}`);
      return n;
    },
    // The consumer, the provider of the item, the auditor and the administrator can read an artefact.
    get(id, p) {
      const r = q.get(db, 'SELECT * FROM consent_artefacts WHERE id=?', String(id || '')); need(r, 404, 'no such consent artefact');
      const it = catalogue.get(r.item_id);
      const ok = (p.email && p.email === r.consumer) || ['admin', 'auditor'].includes(p.role) || (it && p.dn && it.owner_dn === p.dn);
      need(ok, p.email || p.role !== 'anonymous' ? 403 : 401, 'only the consumer, the provider, the auditor or the administrator can read this artefact');
      return view(r);
    },
    forConsents: ids => Object.fromEntries(ids.length ? q.all(db, `SELECT * FROM consent_artefacts WHERE consent_id IN (${ids.map(() => '?').join(',')})`, ...ids).map(r => [r.consent_id, { id: r.id, status: statusOf(r), validTo: iso(r.valid_to) }]) : []),
  };
  return api;
}
