// Officer accounts for the web console: scrypt password hashes, server-side sessions, CSRF tokens and lockout.
// API clients authenticate with their X.509 certificate instead (BIS 4.4, 5.1); a console account is linked to one certificate.
import crypto from 'node:crypto';
import { q } from '../db.js';
import { iso, sha256, fail, need } from '../util.js';

export const ROLES = {
  admin: 'DX administrator: organisations, certificates, accounts, backups',
  provider: 'Data officer of a provider: catalogue items, policies, consent',
  consumer: 'Consumer: discover data, request tokens, read resources',
  operator: 'ICCC operator: dashboards, alerts, reports',
  auditor: 'Auditor: read-only audit log and statistics',
  analytics_provider: 'Analytics provider: plug analytics into the CIL',
};
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const LOCK_MIN = 15;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
export function checkPassword(pw, stored) {
  const [alg, N, r, p, salt, dk] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(dk, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(want, got);
}
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 12) return 'password must be at least 12 characters';
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'password must contain letters and digits';
  return null;
}

export function makeAccounts(db, cfg, audit) {
  const DUMMY = hashPassword('dummy-password-for-timing-1');
  return {
    create({ username, password, role, certSerial = null, displayName, mustChange = false }, by = 'system') {
      need(/^[a-z0-9._@-]{3,64}$/i.test(username || ''), 400, 'username must be 3-64 letters, digits or . _ @ -');
      need(ROLES[role], 400, 'unknown role');
      const prob = passwordProblem(password); need(!prob, 400, prob);
      need(!q.get(db, 'SELECT 1 FROM accounts WHERE username=?', username), 409, 'username already exists');
      if (certSerial) need(q.get(db, 'SELECT 1 FROM certs WHERE serial=?', certSerial), 400, 'linked certificate not found');
      q.run(db, 'INSERT INTO accounts (username, pw_hash, role, cert_serial, display_name, must_change, created_at) VALUES (?,?,?,?,?,?,?)',
        username, hashPassword(password), role, certSerial, displayName || username, mustChange ? 1 : 0, iso(Date.now()));
      audit.log('Identity', by, 'Account created', `${username} role ${role}${certSerial ? ' cert ' + certSerial : ''}`);
      return this.get(username);
    },
    get(username) {
      const a = q.get(db, 'SELECT username, role, cert_serial, display_name, failures, locked_until, must_change, created_at FROM accounts WHERE username=?', username);
      return a || null;
    },
    list() { return q.all(db, 'SELECT username, role, cert_serial, display_name, locked_until, must_change, created_at FROM accounts ORDER BY username'); },
    login(username, password, ip) {
      const a = q.get(db, 'SELECT * FROM accounts WHERE username=?', String(username || ''));
      if (!a) { checkPassword(password, DUMMY); audit.log('Identity', String(username || '').slice(0, 64), 'Login failed', 'unknown user ' + ip, false); fail(401, 'wrong username or password'); }
      if (a.locked_until && Date.parse(a.locked_until) > Date.now()) {
        audit.log('Identity', a.username, 'Login refused', 'account locked ' + ip, false);
        fail(423, 'account locked after repeated failures; try again later or ask the administrator');
      }
      if (!checkPassword(password, a.pw_hash)) {
        const f = a.failures + 1, lock = f >= cfg.loginMaxFailures ? iso(Date.now() + LOCK_MIN * 60e3) : null;
        q.run(db, 'UPDATE accounts SET failures=?, locked_until=? WHERE username=?', lock ? 0 : f, lock, a.username);
        audit.log('Identity', a.username, lock ? 'Account locked' : 'Login failed', 'bad password ' + ip, false);
        fail(401, 'wrong username or password');
      }
      q.run(db, 'UPDATE accounts SET failures=0, locked_until=NULL WHERE username=?', a.username);
      const sid = crypto.randomBytes(32).toString('base64url'), csrf = crypto.randomBytes(24).toString('base64url');
      q.run(db, 'INSERT INTO sessions (id_hash, username, csrf, expires_at, created_at) VALUES (?,?,?,?,?)',
        sha256(sid), a.username, csrf, Date.now() + cfg.sessionTtlSec * 1000, iso(Date.now()));
      audit.log('Identity', a.username, 'Login', 'session started ' + ip);
      return { sid, csrf, mustChange: !!a.must_change };
    },
    session(sid) {
      if (!sid) return null;
      const s = q.get(db, 'SELECT * FROM sessions WHERE id_hash=?', sha256(sid));
      if (!s) return null;
      if (s.expires_at < Date.now()) { q.run(db, 'DELETE FROM sessions WHERE id_hash=?', s.id_hash); return null; }
      return s;
    },
    logout(sid, who) { q.run(db, 'DELETE FROM sessions WHERE id_hash=?', sha256(sid || '')); audit.log('Identity', who, 'Logout', ''); },
    changePassword(username, oldPw, newPw) {
      const a = q.get(db, 'SELECT * FROM accounts WHERE username=?', username);
      need(a && checkPassword(oldPw, a.pw_hash), 401, 'current password is wrong');
      const prob = passwordProblem(newPw); need(!prob, 400, prob);
      need(oldPw !== newPw, 400, 'new password must differ from the old one');
      q.run(db, 'UPDATE accounts SET pw_hash=?, must_change=0 WHERE username=?', hashPassword(newPw), username);
      q.run(db, 'DELETE FROM sessions WHERE username=?', username);
      audit.log('Identity', username, 'Password changed', 'all sessions ended');
    },
    unlock(username, by) {
      need(q.get(db, 'SELECT 1 FROM accounts WHERE username=?', username), 404, 'no such account');
      q.run(db, 'UPDATE accounts SET failures=0, locked_until=NULL WHERE username=?', username);
      audit.log('Identity', by, 'Account unlocked', username);
    },
    purgeSessions() { q.run(db, 'DELETE FROM sessions WHERE expires_at < ?', Date.now()); },
  };
}
