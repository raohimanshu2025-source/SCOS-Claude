// Several DX worker processes on one machine sharing one port and one database (BIS 5.6 "scalable").
// Run: DX_WORKERS=4 node src/cluster.js   (DX_WORKERS=auto uses one worker per CPU)
// Requests are spread over the workers; service pause switches, sessions, tokens and the audit chain live in
// the database, so any worker can answer any request. Worker 1 is the leader: it alone runs the timers, the
// simulator and the MQTT and AMQP brokers. A worker that stops is started again; a new leader takes over its jobs.
// Limits: the rate limit counts per worker, and every worker writes to the same SQLite file on this machine.
import cluster from 'node:cluster';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { initPki } from './identity/ca.js';
import { openDb, q } from './db.js';

export function workerCount(v) {
  if (String(v) === 'auto') return Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
  const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(n, 64) : 1;
}

// Primary process: prepare the shared files once, then fork the workers and restart any that stop.
export function startCluster({ workers = workerCount(process.env.DX_WORKERS || 'auto'), exec, env = {}, log = console.log } = {}) {
  const cfg = loadConfig();
  initPki(cfg.pkiDir, { publicName: cfg.publicName }); // created once here, not by every worker at the same time
  const db = openDb(cfg.dbFile);
  const seeded = !!q.get(db, 'SELECT 1 FROM accounts LIMIT 1'); db.close();
  if (!seeded) throw new Error('No accounts yet. Run: npm run seed');
  if (exec) cluster.setupPrimary({ exec });
  const slots = new Map(); // worker id -> slot number (1 = leader)
  let stopping = false;
  const fork = slot => {
    const w = cluster.fork({ ...env, DX_LEADER: slot === 1 ? 'true' : 'false', DX_INSTANCE: `${os.hostname()}-w${slot}`, DX_WORKER_SLOT: String(slot) });
    slots.set(w.id, slot);
  };
  for (let i = 1; i <= workers; i++) fork(i);
  cluster.on('exit', (w, code, sig) => {
    const slot = slots.get(w.id); slots.delete(w.id);
    if (stopping || slot === undefined) return;
    log(`worker ${slot} stopped (${sig || code}); starting it again${slot === 1 ? ' as the leader' : ''}`);
    fork(slot);
  });
  return {
    workers,
    async stop() {
      stopping = true;
      await Promise.all(Object.values(cluster.workers).map(w => new Promise(r => { w.once('exit', r); w.process.kill('SIGTERM'); })));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (cluster.isPrimary) {
    const c = startCluster();
    console.log(`City OS DX: ${c.workers} worker process(es) on one port (demo data)`);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await c.stop(); process.exit(0); });
  } else {
    const { createApp } = await import('./server.js');
    const app = createApp();
    const a = await app.listen();
    console.log(`worker ${process.env.DX_WORKER_SLOT}${app.cfg.leader ? ' (leader)' : ''} ready on ${a.port}`);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.close(); process.exit(0); });
  }
}
