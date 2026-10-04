// Citizen alerts with officer approval (our addition, not asked for by the two documents).
// A department officer or the control room drafts an alert; a different control room officer or the
// administrator approves or refuses it. Only approved, unexpired alerts appear on the public portal.
// Nothing is sent by SMS, e-mail or app: the alert is shown on the portal only. Every step is audited.
import { q } from './db.js';
import { iso, str, fail, need } from './util.js';
import { actorOf } from './identity/identity.js';

export const ALERT_KINDS = ['flood', 'water', 'power', 'traffic', 'health', 'fire', 'air', 'other'];
export const ALERT_LEVELS = ['info', 'advisory', 'warning'];
const DRAFTERS = ['provider', 'operator', 'admin'];
const APPROVERS = ['operator', 'admin'];
const READERS = ['provider', 'operator', 'admin', 'auditor'];

export function makeCitizenAlerts(db, audit) {
  const orgName = id => (id ? q.get(db, 'SELECT name FROM orgs WHERE id=?', id)?.name : null) || 'City control room';
  const row = id => q.get(db, 'SELECT * FROM citizen_alerts WHERE id=?', Number(id));
  const live = r => r.status === 'approved' && (!r.expires_at || Date.parse(r.expires_at) > Date.now());
  // What the public sees: no officer names or e-mail addresses, only the department and the approval time.
  const publicView = r => ({ id: r.id, kind: r.kind, level: r.level, title: r.title, message: r.message, titleHi: r.title_hi || null, messageHi: r.message_hi || null, area: r.area, department: r.department, approvedAt: r.decided_at, expiresAt: r.expires_at });
  const roleCheck = (p, rs) => need(rs.includes(p.role), p.role === 'anonymous' ? 401 : 403, `this needs one of these roles: ${rs.join(', ')}`);

  return {
    publicList: () => q.all(db, "SELECT * FROM citizen_alerts WHERE status='approved' ORDER BY decided_at DESC").filter(live).map(publicView),
    all(p) { roleCheck(p, READERS); return q.all(db, 'SELECT * FROM citizen_alerts ORDER BY id DESC LIMIT 200').map(r => ({ ...r, live: live(r) })); },
    draft(p, b) {
      roleCheck(p, DRAFTERS);
      const title = str(b.title, 120), message = str(b.message, 600);
      need(title && message, 400, 'title and message are required');
      need(ALERT_KINDS.includes(b.kind), 400, `kind must be one of: ${ALERT_KINDS.join(', ')}`);
      need(ALERT_LEVELS.includes(b.level), 400, `level must be one of: ${ALERT_LEVELS.join(', ')}`);
      const hours = Number(b.hours ?? 24);
      need(Number.isFinite(hours) && hours >= 1 && hours <= 24 * 30, 400, 'hours must be between 1 and 720');
      const now = Date.now();
      const r = q.run(db, `INSERT INTO citizen_alerts (kind, level, title, message, title_hi, message_hi, area, department, status, drafted_by, drafted_at, hours)
        VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)`, b.kind, b.level, title, message, str(b.titleHi, 120) || null, str(b.messageHi, 600) || null, str(b.area, 120) || 'Whole city', orgName(p.orgId), actorOf(p), iso(now), hours);
      audit.log('CIL', actorOf(p), 'Citizen alert drafted', `#${r.lastInsertRowid} ${b.level} ${b.kind}: ${title}`);
      return row(r.lastInsertRowid);
    },
    decide(p, id, approve, note) {
      roleCheck(p, APPROVERS);
      const r = row(id); need(r, 404, 'no such alert');
      need(r.status === 'pending', 409, `this alert is already ${r.status}`);
      // Two-person rule: the officer who wrote the alert cannot approve it.
      if (r.drafted_by === actorOf(p)) fail(403, 'a different officer must approve this alert (two-person rule)');
      const now = Date.now();
      const status = approve ? 'approved' : 'refused';
      q.run(db, 'UPDATE citizen_alerts SET status=?, decided_by=?, decided_at=?, note=?, expires_at=? WHERE id=?', status, actorOf(p), iso(now), str(note, 300) || null, approve ? iso(now + r.hours * 3600e3) : null, r.id);
      audit.log('CIL', actorOf(p), approve ? 'Citizen alert approved' : 'Citizen alert refused', `#${r.id}: ${r.title}${note ? ' (' + str(note, 300) + ')' : ''}`);
      return row(r.id);
    },
    withdraw(p, id) {
      const r = row(id); need(r, 404, 'no such alert');
      need(APPROVERS.includes(p.role) || r.drafted_by === actorOf(p), p.role === 'anonymous' ? 401 : 403, 'only the control room, the administrator or the officer who wrote it can withdraw an alert');
      need(['pending', 'approved'].includes(r.status), 409, `this alert is already ${r.status}`);
      q.run(db, "UPDATE citizen_alerts SET status='withdrawn', withdrawn_by=?, withdrawn_at=? WHERE id=?", actorOf(p), iso(Date.now()), r.id);
      audit.log('CIL', actorOf(p), 'Citizen alert withdrawn', `#${r.id}: ${r.title}`);
      return row(r.id);
    },
    counts: () => Object.fromEntries(q.all(db, 'SELECT status, COUNT(*) n FROM citizen_alerts GROUP BY status').map(x => [x.status, x.n])),
  };
}
