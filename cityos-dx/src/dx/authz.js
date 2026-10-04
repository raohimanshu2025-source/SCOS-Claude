// Authorization service (BIS 4.5.2, 5.2-5.4, 7.4-7.6): policies P = (C, A), consent, licences, tokens,
// introspection and revocation. Tokens are opaque: only their SHA-256 hash is stored.
import { q, tx } from '../db.js';
import { iso, fail, need, randHex, sha256, str } from '../util.js';
import { LABEL_CLASSES, checkPolicy, LABEL_DEFAULTS } from './model.js';
import { actorOf } from '../identity/identity.js';

export function makeAuthz(db, cfg, audit, catalogue, notify, artefacts = null, central = null) {
  const cache = new Map(); // resource-server introspection cache: tokenHash|itemId -> expiry (BIS 4.5.2.2)
  const state = { up: true };
  const providerEmail = it => {
    const prov = it.doc.provider && catalogue.doc(it.doc.provider.value);
    return prov?.organizationInfo?.value?.email || null;
  };

  // Runs the provider's rules for one item. Returns { ok, via } or { ok:false, code, msg, consent }.
  function decide(p, it, purpose) {
    const art = artefacts && it.policy && p.email ? artefacts.check(p.email, it) : null; // an expired consent takes the consumer off the policy
    const pol = it.policy;
    if (!pol) return { ok: false, code: 400, msg: `${it.id} is not a resource item` };
    if (!p.email) return { ok: false, code: 401, msg: 'identity required: anonymous consumers can read public items only (BIS 5.4.2)' };
    if (pol.label === 'public') return { ok: true, via: 'public item' };
    const need_ = LABEL_CLASSES[pol.label];
    if (!need_.includes(p.cls)) return { ok: false, code: 403, msg: `class ${p.cls} ${p.via === 'id-token' ? 'identity (ID token)' : 'certificate'} cannot access ${pol.label} data; needs class ${need_.join(' or ')} (BIS 5.4.2)` };
    const cr_ = central?.check(p, it); if (cr_) return { ok: false, code: 403, msg: cr_ }; // state or national rules only narrow access
    if (pol.C.includes(p.email)) return art?.status === 'active' ? { ok: true, via: `policy (consent artefact ${art.id})`, until: art.validTo } : { ok: true, via: 'policy' };
    const lic = q.get(db, 'SELECT app FROM licences WHERE item_id=? AND developer=?', it.id, p.email);
    if (lic) return { ok: true, via: 'licence agreement for ' + lic.app };
    let cr = q.get(db, `SELECT id FROM consents WHERE consumer=? AND item_id=? AND status='pending'`, p.email, it.id);
    if (!cr) {
      cr = { id: 'CR-' + randHex(4).toUpperCase() };
      q.run(db, `INSERT INTO consents (id, consumer, item_id, purpose, status, cls, org, created_at) VALUES (?,?,?,?, 'pending', ?,?,?)`,
        cr.id, p.email, it.id, str(purpose) || 'Not stated', p.cls, p.orgId, iso(Date.now()));
      audit.log('Consent', 'Data Exchange', 'Consent request sent to provider', `${cr.id} ${p.email} -> ${it.id}`);
      notify.push(providerEmail(it), `Consent request ${cr.id} from ${p.email} (class ${p.cls}) for ${it.doc.name?.value || it.id}. Purpose: ${str(purpose) || 'not stated'}`);
    }
    return { ok: false, code: 403, msg: `consumer is not on the policy; consent request ${cr.id} has been sent to the provider (BIS 4.3, 7.4)`, consent: cr.id };
  }

  const api = {
    state,
    setUp(up, by) { state.up = !!up; audit.log('Operations', by, up ? 'Authorization service resumed' : 'Authorization service paused', ''); },
    decide,
    // POST /auth/v1/token  (Figure 2 steps 2-5)
    requestToken(p, request, purpose) {
      need(state.up, 503, 'authorization service unavailable; retry later (BIS 5.6)');
      need(Array.isArray(request) && request.length && request.length <= 50, 400, 'request must be a list of 1-50 {id} objects');
      const items = request.map(r => { const it = catalogue.get(String(r?.id || '')); need(it, 404, 'no such item: ' + r?.id); return it; });
      const decisions = items.map(it => ({ it, d: decide(p, it, purpose) }));
      const bad = decisions.filter(x => !x.d.ok);
      if (bad.length) {
        for (const b of bad) audit.log('Authorization', actorOf(p), 'Token refused', `${b.it.id}: ${b.d.msg}`, false);
        const worst = bad.find(b => b.d.code === 401) || bad[0];
        fail(worst.d.code, worst.d.msg, { denied: bad.map(b => ({ id: b.it.id, reason: b.d.msg, consent: b.d.consent })) });
      }
      const token = `${cfg.authHost}/${p.email}/${randHex(32)}`; // BIS 5.2 token shape
      const exp = Math.min(Date.now() + Math.min(cfg.tokenTtlSec, central ? central.maxTtl() : Infinity) * 1000, ...decisions.map(x => x.d.until || Infinity)); // never outlives a consent artefact
      const duties = Object.fromEntries(items.map(it => [it.id, it.policy.A]));
      const policyRef = items.map(it => `${it.id}#v${it.policy.version}`).join(' ');
      q.run(db, 'INSERT INTO tokens (hash, consumer, cert_serial, items, cls, policy_ref, duties, via, issued_at, expires_at, tail) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        sha256(token), p.email, p.serial, JSON.stringify(items.map(i => i.id)), p.cls, policyRef, JSON.stringify(duties),
        [...new Set(decisions.map(x => x.d.via))].join('; '), iso(Date.now()), exp, token.slice(-8));
      audit.log('Authorization', actorOf(p), 'Token granted', `${items.map(i => i.id).join(', ')} via ${decisions[0].d.via} token …${token.slice(-8)}`);
      artefacts?.used(p.email, decisions.filter(x => x.d.until).map(x => x.it.id));
      return { token, 'token-type': 'IUDX', 'expires-in': Math.round((exp - Date.now()) / 1000), expiry: iso(exp), via: decisions.map(x => ({ id: x.it.id, via: x.d.via })) };
    },
    // POST /auth/v1/token/introspect  (Figure 2 steps 7-10); `rs` is the calling resource server principal
    introspect(rs, token, itemId, { useCache = true } = {}) {
      need(state.up, 503, 'authorization service unavailable');
      need(rs.cls === 1 && rs.kind === 'rs', 403, 'only a resource server with a class 1 certificate may introspect tokens (BIS 5.4.2)');
      const h = sha256(String(token || ''));
      const key = h + '|' + itemId;
      const t = q.get(db, 'SELECT * FROM tokens WHERE hash=?', h);
      if (useCache && cache.get(key) > Date.now() && t && !t.revoked_at) return { ok: true, cached: true, rec: t };
      if (!t) return { ok: false, reason: 'unknown token' };
      if (t.revoked_at) return { ok: false, reason: 'token revoked' };
      if (t.expires_at <= Date.now()) return { ok: false, reason: 'token expired' };
      const items = JSON.parse(t.items);
      if (itemId && !items.includes(itemId)) return { ok: false, reason: 'token does not cover this item' };
      if (itemId) {
        const it = catalogue.get(itemId);
        if (!it) return { ok: false, reason: 'item no longer exists' };
        const rsItem = catalogue.doc(it.doc.resourceServer.value);
        const host = new URL(rsItem.resourceServerHTTPAccessURL.value).hostname;
        if (rs.cn !== host) return { ok: false, reason: `resource server ${rs.cn} does not serve ${itemId} (expected ${host})` };
      }
      if (t.cert_serial && !t.cert_serial.startsWith('ext:')) { // certificates of licensed CAs are checked against their CRL on each connection
        const c = q.get(db, 'SELECT status FROM certs WHERE serial=?', t.cert_serial);
        if (!c || c.status !== 'valid') return { ok: false, reason: 'the consumer certificate was revoked' };
      }
      cache.set(key, Math.min(t.expires_at, Date.now() + 5 * 60e3));
      audit.log('Authorization', rs.cn, 'Token introspected', `…${t.tail} for ${itemId || items.join(', ')}`);
      return { ok: true, cached: false, rec: t, body: { consumer: t.consumer, 'consumer-certificate-class': t.cls, expiry: iso(t.expires_at), request: items.map(id => ({ id, duties: JSON.parse(t.duties)[id] })), policy: t.policy_ref } }; // 7.4: reference to the policy object
    },
    recordAccess(hash) { q.run(db, 'UPDATE tokens SET accesses=accesses+1, last_access=? WHERE hash=?', iso(Date.now()), hash); },
    // POST /auth/v1/token/revoke. A consumer revokes its own tokens; a provider revokes a consumer's access to an item (BIS 7.6).
    revoke(p, { token, tokens, id, consumer }) {
      const now = iso(Date.now());
      // Figure 11: the provider posts body={"token": <token>}; the holder may also revoke it this way.
      if (typeof token === 'string') {
        const h = sha256(token); const t = q.get(db, 'SELECT * FROM tokens WHERE hash=?', h);
        need(t, 404, 'unknown token');
        const items = JSON.parse(t.items);
        if (t.consumer !== p.email) for (const iid of items) { const it = catalogue.get(iid); need(it, 404, 'item no longer exists'); catalogue.assertOwner(it, p, 'revoke'); }
        q.run(db, 'UPDATE tokens SET revoked_at=? WHERE hash=? AND revoked_at IS NULL', now, h);
        for (const k of cache.keys()) if (k.startsWith(h)) cache.delete(k);
        audit.log('Authorization', actorOf(p), 'POST /auth/v1/token/revoke', `token …${t.tail} of ${t.consumer} for ${items.join(', ')}`);
        if (t.consumer !== p.email) notify.push(t.consumer, `A token for ${items.join(', ')} was revoked by the provider`);
        return { revoked: 1 };
      }
      if (Array.isArray(tokens)) {
        let n = 0;
        for (const tk of tokens) {
          const h = sha256(String(tk)); const t = q.get(db, 'SELECT consumer, revoked_at FROM tokens WHERE hash=?', h);
          need(t, 404, 'unknown token'); need(t.consumer === p.email, 403, 'you can only revoke your own tokens');
          q.run(db, 'UPDATE tokens SET revoked_at=? WHERE hash=? AND revoked_at IS NULL', now, h); n++;
          for (const k of cache.keys()) if (k.startsWith(h)) cache.delete(k);
        }
        audit.log('Authorization', actorOf(p), 'POST /auth/v1/token/revoke', `${n} own token(s)`);
        return { revoked: n };
      }
      const it = catalogue.get(String(id || '')); need(it, 404, 'no such item');
      catalogue.assertOwner(it, p, 'revoke');
      need(consumer, 400, 'consumer required');
      const rows = q.all(db, 'SELECT hash, items FROM tokens WHERE consumer=? AND revoked_at IS NULL', consumer).filter(r => JSON.parse(r.items).includes(it.id));
      tx(db, () => {
        for (const r of rows) q.run(db, 'UPDATE tokens SET revoked_at=? WHERE hash=?', now, r.hash);
        const pol = it.policy; const C = pol.C.filter(c => c !== consumer);
        q.run(db, 'UPDATE items SET policy=? WHERE id=?', JSON.stringify({ ...pol, C, version: pol.version + 1 }), it.id);
        q.run(db, `UPDATE consents SET status='revoked', decided_at=?, decided_by=? WHERE consumer=? AND item_id=? AND status='approved'`, now, actorOf(p), consumer, it.id);
      });
      artefacts?.revoke(consumer, it.id, p);
      for (const r of rows) for (const k of cache.keys()) if (k.startsWith(r.hash)) cache.delete(k);
      audit.log('Authorization', actorOf(p), 'POST /auth/v1/token/revoke', `${consumer} on ${it.id}: ${rows.length} token(s), removed from policy`);
      notify.push(consumer, `Your access to ${it.doc.name?.value || it.id} was revoked by the provider`);
      return { revoked: rows.length };
    },
    myTokens: email => q.all(db, 'SELECT tail, items, cls, policy_ref, via, issued_at, expires_at, revoked_at, accesses, last_access FROM tokens WHERE consumer=? ORDER BY issued_at DESC LIMIT 200', email)
      .map(t => ({ ...t, items: JSON.parse(t.items), expiry: iso(t.expires_at), status: t.revoked_at ? 'revoked' : t.expires_at < Date.now() ? 'expired' : 'active' })),

    // Access control list management (BIS Table 2 Manage, 5.3, 5.4)
    getPolicy(id, p) { const it = catalogue.get(id); need(it && it.policy, 404, 'no such resource item'); catalogue.assertOwner(it, p, 'view policy'); return { id, ...it.policy, text: policyText(it.policy) }; },
    setPolicy(id, body, p) {
      const it = catalogue.get(id); need(it && it.policy, 404, 'no such resource item'); catalogue.assertOwner(it, p, 'set policy');
      const label = body.label || it.policy.label;
      const next = { label, C: body.C ?? it.policy.C, A: { ...(label !== it.policy.label ? LABEL_DEFAULTS[label] : it.policy.A), ...(body.A || {}) } };
      const errs = checkPolicy(next); need(!errs.length, 400, errs.join('; '), { errors: errs });
      const pol = { ...next, C: [...new Set(next.C.map(c => c.toLowerCase()))], version: it.policy.version + 1 };
      tx(db, () => {
        const doc = { ...it.doc, accessPolicyLabel: { type: 'Property', value: label } };
        q.run(db, 'UPDATE items SET policy=?, label=?, doc=?, modified_at=? WHERE id=?', JSON.stringify(pol), label, JSON.stringify(doc), iso(Date.now()), id);
        // consumers dropped from C lose their tokens
        const dropped = it.policy.C.filter(c => !pol.C.includes(c));
        for (const c of dropped) for (const r of q.all(db, 'SELECT hash, items FROM tokens WHERE consumer=? AND revoked_at IS NULL', c)) if (JSON.parse(r.items).includes(id)) q.run(db, 'UPDATE tokens SET revoked_at=? WHERE hash=?', iso(Date.now()), r.hash);
      });
      cache.clear();
      audit.log('Manage', actorOf(p), 'Policy set', `${id} v${pol.version}: ${policyText(pol)}`);
      if (label !== it.policy.label) notify.changed(id, `changed label to ${label}`);
      return { id, ...pol, text: policyText(pol) };
    },

    // Table 2 Manage "Delete": the policy goes back to its label's Table 4 defaults with no consumers listed.
    resetPolicy(id, p) {
      const it = catalogue.get(id); need(it && it.policy, 404, 'no such resource item'); catalogue.assertOwner(it, p, 'delete policy');
      return api.setPolicy(id, { label: it.policy.label, C: [], A: { ...LABEL_DEFAULTS[it.policy.label] } }, p);
    },
    // Table 2 Manage: list and view information about consumers of the provider's items
    consumers(p, email) {
      need(p.cls === 3, 403, 'provider data officers only');
      const own = catalogue.all('resourceItem').filter(i => i.owner_dn === p.dn && i.policy);
      const byEmail = new Map();
      const add = (e, k, v) => { if (!byEmail.has(e)) byEmail.set(e, { consumer: e, onPolicy: [], tokens: 0, activeTokens: 0, consents: [] }); const r = byEmail.get(e); if (k === 'tokens') { r.tokens++; if (v) r.activeTokens++; } else r[k].push(v); };
      for (const it of own) for (const e of it.policy.C) add(e, 'onPolicy', it.id);
      const ids = new Set(own.map(i => i.id));
      for (const t of q.all(db, 'SELECT consumer, items, revoked_at, expires_at FROM tokens')) if (JSON.parse(t.items).some(i => ids.has(i))) add(t.consumer, 'tokens', !t.revoked_at && t.expires_at > Date.now());
      for (const c of q.all(db, 'SELECT id, consumer, item_id, status, cls, org FROM consents')) if (ids.has(c.item_id)) add(c.consumer, 'consents', { id: c.id, item: c.item_id, status: c.status, cls: c.cls });
      for (const r of byEmail.values()) { const cert = q.get(db, `SELECT cls, kind, org_id FROM certs WHERE email=? AND status='valid' ORDER BY issued_at DESC`, r.consumer); Object.assign(r, cert ? { certificateClass: cert.cls, kind: cert.kind, org: cert.org_id } : {}); }
      const list = [...byEmail.values()];
      if (email) { const one = list.find(r => r.consumer === String(email).toLowerCase()); need(one, 404, 'not a consumer of your items'); return one; }
      return list;
    },

    // Consent (BIS 4.3, 5.3 consent history private to provider, 5.6 status of consent flows)
    consents(p, { status, role } = {}) {
      const all = q.all(db, 'SELECT * FROM consents ORDER BY created_at DESC');
      const mine = role === 'consumer' || p.cls !== 3
        ? all.filter(c => c.consumer === p.email)
        : all.filter(c => { const it = catalogue.get(c.item_id) || q.get(db, 'SELECT owner_dn FROM items WHERE id=?', c.item_id); return it && it.owner_dn === p.dn; });
      const out = mine.filter(c => !status || c.status === status);
      const arts = artefacts ? artefacts.forConsents(out.map(c => c.id)) : {};
      return out.map(c => ({ ...c, artefact: arts[c.id] || null }));
    },
    decideConsent(id, approve, p, opts = {}) {
      const c = q.get(db, 'SELECT * FROM consents WHERE id=?', id); need(c, 404, 'no such consent request');
      const it = catalogue.get(c.item_id); need(it, 404, 'item no longer exists');
      catalogue.assertOwner(it, p, 'decide consent');
      need(c.status === 'pending', 409, 'already ' + c.status);
      tx(db, () => {
        q.run(db, 'UPDATE consents SET status=?, decided_at=?, decided_by=? WHERE id=?', approve ? 'approved' : 'rejected', iso(Date.now()), actorOf(p), id);
        if (approve && !artefacts) { const pol = it.policy; if (!pol.C.includes(c.consumer)) q.run(db, 'UPDATE items SET policy=? WHERE id=?', JSON.stringify({ ...pol, C: [...pol.C, c.consumer], version: pol.version + 1 }), it.id); }
        // with consent artefacts, the signed artefact token is what adds the consumer to the policy (BIS 4.3)
        if (approve && artefacts) artefacts.create(c, it, p, opts);
      });
      audit.log('Consent', actorOf(p), approve ? 'Consent approved' : 'Consent rejected', `${id} ${c.consumer} -> ${c.item_id}`);
      notify.push(c.consumer, `Consent request ${id} for ${it.doc.name?.value || it.id} was ${approve ? 'approved. Request a token again.' : 'rejected.'}`);
      return q.get(db, 'SELECT * FROM consents WHERE id=?', id);
    },
    // All consent flows and data flows of a provider, with status (BIS 5.6 first failure case)
    flows(p) {
      need(p.cls === 3, 403, 'provider data officers only');
      const own = new Set(catalogue.all('resourceItem').filter(i => i.owner_dn === p.dn).map(i => i.id));
      const consents = q.all(db, 'SELECT * FROM consents ORDER BY created_at DESC').filter(c => own.has(c.item_id));
      const tokens = q.all(db, 'SELECT tail, consumer, items, cls, via, issued_at, expires_at, revoked_at, accesses, last_access FROM tokens ORDER BY issued_at DESC')
        .map(t => ({ ...t, items: JSON.parse(t.items).filter(i => own.has(i)) })).filter(t => t.items.length)
        .map(t => ({ ...t, status: t.revoked_at ? 'revoked' : t.expires_at < Date.now() ? 'expired' : 'active', expiry: iso(t.expires_at) }));
      return { consents, dataFlows: tokens };
    },
    // Licence agreement between provider and app developer (BIS 4.3)
    addLicence(id, { app, developer, terms }, p) {
      const it = catalogue.get(id); need(it && it.policy, 404, 'no such resource item'); catalogue.assertOwner(it, p, 'licence');
      need(str(app) && str(developer).includes('@') && str(terms), 400, 'app, developer e-mail and terms are required');
      q.run(db, 'INSERT OR REPLACE INTO licences (item_id, app, developer, terms, created_at) VALUES (?,?,?,?,?)', id, str(app), str(developer).toLowerCase(), str(terms, 2000), iso(Date.now()));
      audit.log('Consent', actorOf(p), 'Licence agreement recorded', `${id} app ${str(app)} developer ${developer}`);
      return q.all(db, 'SELECT * FROM licences WHERE item_id=?', id);
    },
    removeLicence(id, app, p) {
      const it = catalogue.get(id); need(it, 404, 'no such item'); catalogue.assertOwner(it, p, 'licence');
      const lic = q.get(db, 'SELECT developer FROM licences WHERE item_id=? AND app=?', id, app); need(lic, 404, 'no such licence');
      q.run(db, 'DELETE FROM licences WHERE item_id=? AND app=?', id, app);
      q.run(db, `UPDATE tokens SET revoked_at=? WHERE consumer=? AND revoked_at IS NULL AND via LIKE 'licence%' AND items LIKE ?`, iso(Date.now()), lic.developer, `%"${id}"%`);
      cache.clear();
      audit.log('Consent', actorOf(p), 'Licence agreement ended', `${id} app ${app}`);
    },
    licences: id => q.all(db, 'SELECT * FROM licences WHERE item_id=?', id),
  };
  return api;
}

export function policyText(p) {
  return `P = ( C = { ${p.C.length ? p.C.join(', ') : 'none listed'} ; certificate class ∈ {${LABEL_CLASSES[p.label].join(',') || 'any'}} }, A = { ${Object.entries(p.A).map(([k, v]) => k + ': ' + v).join('; ')} } )`;
}
