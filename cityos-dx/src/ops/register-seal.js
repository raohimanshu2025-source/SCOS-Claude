// Seal for the past incident register (our addition, found in the 4 Nov 2026 verification): the audit chain
// catches edits to the log, but not a quiet edit to an incident row. At seeding, each row gets a SHA-256 hash,
// the hashes are joined into one register digest, and that digest is written into the signed audit log.
// `check` recomputes everything from the rows as stored now and says which incidents changed, if any.
import crypto from 'node:crypto';
import { q, kv } from '../db.js';

const KEY = 'seal:incidents';
// Same row, same hash, whatever order its fields were stored in.
const canon = v => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',')}}` : JSON.stringify(v));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rowsOf = (db, item) => q.all(db, 'SELECT n, data FROM table_rows WHERE item_id=? ORDER BY n', item).map(r => { const d = JSON.parse(r.data); return { n: r.n, id: d.incidentId || `row-${r.n}`, h: sha(canon(d)) }; });
const digestOf = rows => sha(rows.map(r => r.h).join('\n'));

export function sealIncidents(app, item) {
  const rows = rowsOf(app.db, item), digest = digestOf(rows), at = new Date().toISOString();
  kv.set(app.db, KEY, { item, at, digest, rows });
  app.audit.log('Operations', 'seed', 'incident register sealed', `${item} rows=${rows.length} digest=${digest}`);
  return { rows: rows.length, digest };
}

export function checkIncidents(db) {
  const s = kv.get(db, KEY); if (!s) return null;
  const now = rowsOf(db, s.item), digest = digestOf(now);
  const was = new Map(s.rows.map(r => [r.id, r.h])), is = new Map(now.map(r => [r.id, r.h]));
  const changed = [...is].filter(([id, h]) => was.has(id) && was.get(id) !== h).map(([id]) => id);
  const added = [...is.keys()].filter(id => !was.has(id)), removed = [...was.keys()].filter(id => !is.has(id));
  // the sealed digest must also be the one written into the signed audit log, so the stored seal itself cannot be swapped
  const inAudit = !!q.get(db, "SELECT 1 FROM audit WHERE action='incident register sealed' AND detail LIKE ? LIMIT 1", `%digest=${s.digest}`);
  return { rows: now.length, sealedAt: s.at, sealedDigest: s.digest, digest, unchanged: digest === s.digest && inAudit, sealInAudit: inAudit, changed, added, removed };
}
