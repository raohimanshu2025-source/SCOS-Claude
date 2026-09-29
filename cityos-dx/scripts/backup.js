// Online backup of the database (safe while the server runs). Keeps the newest DX_BACKUP_KEEP copies (default 14).
// Schedule it daily, e.g. with cron or the systemd timer in deploy/.
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { backupDb, pruneBackups } from '../src/ops/ops.js';
const cfg = loadConfig();
const db = openDb(cfg.dbFile);
const b = backupDb(db, cfg.backupDir, process.argv[2] || 'scheduled');
const pruned = pruneBackups(cfg.backupDir, Number(process.env.DX_BACKUP_KEEP || 14));
db.close();
console.log(JSON.stringify({ ...b, pruned }, null, 2));
if (b.check.integrity !== 'ok') process.exit(1);
