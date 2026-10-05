// BIS 4.1 (3) non-repudiable audit trail, 4.3 token logging, 5.5 log all events.
// Each entry is SHA-256 chained to the one before and signed with the server's Ed25519 audit key.
import crypto from 'node:crypto';
import { q } from './db.js';

export const IFACES = ['Manage', 'Discover', 'Authorization', 'Resource', 'Consent', 'Identity', 'CIL', 'Operations'];
const canon = e => [e.seq, e.ts, e.iface, e.actor, e.action, e.detail, e.ok ? 1 : 0].join('\u001f');

export function makeAudit(db, keyPem) {
  const priv = crypto.createPrivateKey(keyPem);
  const pub = crypto.createPublicKey(priv);
  const pubPem = pub.export({ type: 'spki', format: 'pem' });
  const insert = db.prepare('INSERT INTO audit (seq, ts, iface, actor, action, detail, ok, prev, hash, sig) VALUES (?,?,?,?,?,?,?,?,?,?)');
  // Several worker processes share the database: the write lock makes each entry chain to the true last one.
  function log(...a) {
    if (db.isTransaction) return append(...a);
    db.exec('BEGIN IMMEDIATE');
    try { const r = append(...a); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function append(iface, actor, action, detail = '', ok = true) {
    if (!IFACES.includes(iface)) throw new Error('unknown interface ' + iface);
    const last = q.get(db, 'SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1');
    const e = { seq: (last?.seq ?? 0) + 1, ts: new Date().toISOString(), iface, actor: String(actor ?? 'unknown'), action: String(action), detail: String(detail ?? '').slice(0, 2000), ok: !!ok };
    const prev = last?.hash ?? '0'.repeat(64);
    const hash = crypto.createHash('sha256').update(prev + '\u001e' + canon(e)).digest('hex');
    const sig = crypto.sign(null, Buffer.from(hash, 'hex'), priv).toString('base64');
    insert.run(e.seq, e.ts, e.iface, e.actor, e.action, e.detail, e.ok ? 1 : 0, prev, hash, sig);
    return { ...e, prev, hash, sig };
  }
  function verify() {
    let prev = '0'.repeat(64), n = 0;
    for (const r of db.prepare('SELECT * FROM audit ORDER BY seq').iterate()) {
      const e = { ...r, ok: !!r.ok };
      const h = crypto.createHash('sha256').update(prev + '\u001e' + canon(e)).digest('hex');
      if (r.prev !== prev || r.hash !== h) return { ok: false, brokenAt: r.seq, reason: 'hash chain mismatch', checked: n };
      if (!crypto.verify(null, Buffer.from(r.hash, 'hex'), pub, Buffer.from(r.sig, 'base64'))) return { ok: false, brokenAt: r.seq, reason: 'signature invalid', checked: n };
      prev = r.hash; n++;
    }
    return { ok: true, checked: n, head: prev };
  }
  function stats() {
    return q.all(db, 'SELECT iface, COUNT(*) AS events, SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS refused FROM audit GROUP BY iface ORDER BY iface');
  }
  return { log, verify, stats, publicKeyPem: pubPem };
}
