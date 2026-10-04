// SQLite storage through Node's built-in driver. All SQL lives here or uses prepared statements with bound parameters.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL UNIQUE, whitelisted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS certs (serial TEXT PRIMARY KEY, cn TEXT NOT NULL, email TEXT NOT NULL, org_id TEXT, cls INTEGER NOT NULL, kind TEXT NOT NULL,
     dn TEXT NOT NULL, pem TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, not_after TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'valid', revoked_at TEXT, revoke_reason TEXT, issued_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS certs_email ON certs(email)`,
  `CREATE TABLE IF NOT EXISTS csr_requests (id TEXT PRIMARY KEY, subject TEXT NOT NULL, csr TEXT NOT NULL, cn TEXT NOT NULL, email TEXT NOT NULL, cls INTEGER NOT NULL,
     kind TEXT NOT NULL, org_id TEXT, status TEXT NOT NULL, reason TEXT, cert_serial TEXT, created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS accounts (username TEXT PRIMARY KEY, pw_hash TEXT NOT NULL, role TEXT NOT NULL, cert_serial TEXT, display_name TEXT NOT NULL,
     failures INTEGER NOT NULL DEFAULT 0, locked_until TEXT, must_change INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, username TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, item_type TEXT NOT NULL, owner_dn TEXT NOT NULL, owner_org TEXT, doc TEXT NOT NULL, label TEXT, policy TEXT,
     data_kind TEXT, created_at TEXT NOT NULL, modified_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS items_type ON items(item_type)`,
  `CREATE TABLE IF NOT EXISTS readings (item_id TEXT NOT NULL, ts TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (item_id, ts))`,
  `CREATE TABLE IF NOT EXISTS table_rows (item_id TEXT NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (item_id, n))`,
  `CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, consumer TEXT NOT NULL, cert_serial TEXT, items TEXT NOT NULL, cls INTEGER NOT NULL, policy_ref TEXT NOT NULL,
     duties TEXT NOT NULL, via TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at TEXT, tail TEXT NOT NULL,
     accesses INTEGER NOT NULL DEFAULT 0, last_access TEXT)`,
  `CREATE TABLE IF NOT EXISTS consents (id TEXT PRIMARY KEY, consumer TEXT NOT NULL, item_id TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL, cls INTEGER,
     org TEXT, created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS consent_artefacts (id TEXT PRIMARY KEY, consent_id TEXT NOT NULL, consumer TEXT NOT NULL, item_id TEXT NOT NULL, valid_to INTEGER NOT NULL,
     artefact TEXT NOT NULL, token TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, uses INTEGER NOT NULL DEFAULT 0, last_use TEXT)`,
  `CREATE TABLE IF NOT EXISTS licences (item_id TEXT NOT NULL, app TEXT NOT NULL, developer TEXT NOT NULL, terms TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(item_id, app))`,
  `CREATE TABLE IF NOT EXISTS watches (consumer TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY(consumer, item_id))`,
  `CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, msg TEXT NOT NULL, created_at TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, consumer TEXT NOT NULL, item_id TEXT NOT NULL, every_sec INTEGER NOT NULL, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, iface TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
     ok INTEGER NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS analytics (id TEXT PRIMARY KEY, spec TEXT NOT NULL, builtin INTEGER NOT NULL, runs INTEGER NOT NULL DEFAULT 0, last_run TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL, ward TEXT NOT NULL, msg TEXT NOT NULL, source TEXT NOT NULL, ts TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS citizen_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, level TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
     title_hi TEXT, message_hi TEXT, area TEXT NOT NULL, department TEXT NOT NULL, status TEXT NOT NULL, drafted_by TEXT NOT NULL, drafted_at TEXT NOT NULL, hours REAL NOT NULL,
     decided_by TEXT, decided_at TEXT, note TEXT, expires_at TEXT, withdrawn_by TEXT, withdrawn_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS media (item_id TEXT NOT NULL, ts TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (item_id, ts))`,
  `CREATE TABLE IF NOT EXISTS heartbeats (ts TEXT NOT NULL, service TEXT NOT NULL, up INTEGER NOT NULL, PRIMARY KEY (ts, service))`,
  `CREATE TABLE IF NOT EXISTS api_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, service TEXT NOT NULL, route TEXT NOT NULL, status INTEGER NOT NULL, ms REAL NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS api_calls_ts ON api_calls(ts)`,
  `CREATE INDEX IF NOT EXISTS readings_ts ON readings(item_id, ts)`,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  for (const s of SCHEMA) db.exec(s);
  db.exec(`INSERT OR IGNORE INTO meta (k, v) VALUES ('schema_version', '1')`);
  return db;
}

// small helpers so callers never build SQL from strings
export const q = {
  get: (db, sql, ...a) => db.prepare(sql).get(...a),
  all: (db, sql, ...a) => db.prepare(sql).all(...a),
  run: (db, sql, ...a) => db.prepare(sql).run(...a),
};

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
