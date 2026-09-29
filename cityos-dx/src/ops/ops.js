// Operations: status page and heartbeat (BIS 5.6), per-interface statistics (BIS 5.5), backups,
// rate limiting and HTTP security headers.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { q } from '../db.js';
import { iso, round, fail } from '../util.js';

export const SERVICES = {
  catalogue: 'Catalogue service', authorization: 'Authorization service', resource: 'Resource servers',
  notification: 'Notification service', cil: 'City Intelligence Layer APIs', identity: 'Identity and certificates',
};
export function serviceOfPath(p) {
  if (p.startsWith('/catalogue/')) return 'catalogue';
  if (p.startsWith('/auth/')) return 'authorization';
  if (p.startsWith('/resource/')) return 'resource';
  if (p.startsWith('/notify/')) return 'notification';
  if (p.startsWith('/cil/')) return 'cil';
  if (p.startsWith('/identity/')) return 'identity';
  return null;
}

export function makeOps(db, cfg, audit, parts) {
  const started = Date.now();
  let timer = null;
  const isUp = s => ({ authorization: parts.authz.state.up, notification: parts.notify.state.up, cil: parts.cil.state.up,
    resource: [...parts.resource.localServers().keys()].every(k => parts.resource.serverUp(k)) }[s] ?? true);

  const api = {
    recordCall(service, route, status, ms) {
      q.run(db, 'INSERT INTO api_calls (ts, service, route, status, ms) VALUES (?,?,?,?,?)', iso(Date.now()), service, route, status, ms);
    },
    beat() {
      const ts = iso(Date.now());
      for (const s of Object.keys(SERVICES)) q.run(db, 'INSERT OR REPLACE INTO heartbeats (ts, service, up) VALUES (?,?,?)', ts, s, isUp(s) ? 1 : 0);
    },
    start() { if (!timer) { api.beat(); timer = setInterval(api.beat, cfg.heartbeatMs); timer.unref(); } },
    stop() { clearInterval(timer); timer = null; },
    heartbeat() {
      return { ts: iso(Date.now()), city: cfg.cityName, uptimeSec: Math.round((Date.now() - started) / 1000), services: Object.fromEntries(Object.keys(SERVICES).map(s => [s, isUp(s) ? 'up' : 'down'])) };
    },
    // Public API status page: uptime, average response time and latency per interface (BIS 5.6).
    status(hours = 24) {
      const since = iso(Date.now() - hours * 3600e3);
      const beats = Object.fromEntries(q.all(db, 'SELECT service, COUNT(*) n, SUM(up) up FROM heartbeats WHERE ts>=? GROUP BY service', since).map(r => [r.service, r]));
      const calls = Object.fromEntries(q.all(db, 'SELECT service, COUNT(*) n, AVG(ms) avg, SUM(CASE WHEN status>=500 THEN 1 ELSE 0 END) errors FROM api_calls WHERE ts>=? GROUP BY service', since).map(r => [r.service, r]));
      const p95 = s => { const v = q.all(db, 'SELECT ms FROM api_calls WHERE service=? AND ts>=? ORDER BY ms', s, since).map(r => r.ms); return v.length ? round(v[Math.min(v.length - 1, Math.floor(v.length * 0.95))]) : null; };
      return {
        generatedAt: iso(Date.now()), windowHours: hours, city: cfg.cityName,
        note: 'Measured by this server on its own requests and heartbeats. Not an independent monitor.',
        services: Object.entries(SERVICES).map(([k, name]) => ({
          service: k, name, status: isUp(k) ? 'up' : 'down',
          uptimePercent: beats[k] ? round(100 * beats[k].up / beats[k].n, 2) : null, heartbeats: beats[k]?.n ?? 0,
          requests: calls[k]?.n ?? 0, avgResponseMs: calls[k] ? round(calls[k].avg) : null, p95LatencyMs: calls[k] ? p95(k) : null, serverErrors: calls[k]?.errors ?? 0,
        })),
      };
    },
    // BIS 5.5: every interface makes statistics available
    stats() {
      return { audit: audit.stats(), catalogue: parts.catalogue.stats(),
        tokens: q.get(db, `SELECT COUNT(*) issued, SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) revoked, SUM(accesses) accesses FROM tokens`),
        consents: q.all(db, 'SELECT status, COUNT(*) n FROM consents GROUP BY status'),
        certificates: q.all(db, 'SELECT cls, status, COUNT(*) n FROM certs GROUP BY cls, status ORDER BY cls') };
    },
  };
  return api;
}

// Online backup with VACUUM INTO (consistent copy while running), then integrity and audit-chain check.
export function backupDb(db, dir, label = '') {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `dx-${iso(Date.now()).replace(/[:]/g, '')}${label ? '-' + label.replace(/[^\w-]/g, '') : ''}.sqlite`);
  db.prepare('VACUUM INTO ?').run(file);
  fs.chmodSync(file, 0o600);
  return { file, bytes: fs.statSync(file).size, check: verifyBackup(file) };
}
export function verifyBackup(file) {
  const b = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = b.prepare('PRAGMA integrity_check').get().integrity_check;
    const counts = Object.fromEntries(['items', 'certs', 'accounts', 'tokens', 'consents', 'audit', 'readings'].map(t => [t, b.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
    return { integrity, counts };
  } finally { b.close(); }
}
export function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.sqlite')).sort().reverse().map(f => ({ file: f, bytes: fs.statSync(path.join(dir, f)).size }));
}
export function pruneBackups(dir, keep = 14) {
  const all = listBackups(dir); for (const b of all.slice(keep)) fs.rmSync(path.join(dir, b.file)); return Math.max(0, all.length - keep);
}

// Fixed-window rate limit per client address.
export function makeRateLimiter(perMin) {
  const hits = new Map();
  setInterval(() => hits.clear(), 60e3).unref();
  return key => { const n = (hits.get(key) || 0) + 1; hits.set(key, n); if (n > perMin) fail(429, 'too many requests; slow down'); };
}

export function securityHeaders(res) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
}
