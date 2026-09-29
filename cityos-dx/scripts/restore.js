// Restores a backup: node scripts/restore.js <backup file>. Stop the server first.
// The current database is kept as dx.sqlite.before-restore-<time>.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { verifyBackup } from '../src/ops/ops.js';
import { openDb } from '../src/db.js';
import { makeAudit } from '../src/audit.js';
import { pkiPaths } from '../src/identity/ca.js';
const cfg = loadConfig();
const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('usage: node scripts/restore.js <backup file>'); process.exit(2); }
const chk = verifyBackup(src);
if (chk.integrity !== 'ok') { console.error('backup failed integrity check:', chk.integrity); process.exit(1); }
const tmp = openDb(src); const aud = makeAudit(tmp, fs.readFileSync(pkiPaths(cfg.pkiDir).auditKey, 'utf8')).verify(); tmp.close();
if (!aud.ok) { console.error('audit chain in backup does not verify:', aud); process.exit(1); }
for (const ext of ['-wal', '-shm']) fs.rmSync(cfg.dbFile + ext, { force: true });
if (fs.existsSync(cfg.dbFile)) fs.renameSync(cfg.dbFile, `${cfg.dbFile}.before-restore-${Date.now()}`);
fs.mkdirSync(path.dirname(cfg.dbFile), { recursive: true });
fs.copyFileSync(src, cfg.dbFile); fs.chmodSync(cfg.dbFile, 0o600);
console.log(`Restored ${src} -> ${cfg.dbFile}. Rows: ${JSON.stringify(chk.counts)}. Audit entries verified: ${aud.checked}. Start the server again.`);
