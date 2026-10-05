// Standby server for BIS 5.6 ("highly available ... distributed architecture"). Runs on a second machine.
// It pulls a consistent copy of the primary's database every DX_PULL_MS (default 10 s), checks it and keeps it.
// When the primary misses DX_FAILOVER_AFTER pulls in a row (default 3), the standby starts the full DX on the
// latest copy and takes over. The front door (deploy/ha-frontdoor.js) then sends clients to it.
// Limits, stated plainly: changes made in the last pull interval before a failure are lost; there is one writer
// at a time (SQLite), so this is failover, not two servers sharing the load; switching back is a manual step.
// Run: DX_PRIMARY_URL=https://primary:8443 DX_REPLICATION_KEY=... node src/ha/standby.js
// It needs the same pki folder as the primary (copied once), so certificates and signatures stay the same.
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { pkiPaths } from '../identity/ca.js';
import { verifyBackup } from '../ops/ops.js';
import { iso } from '../util.js';
import { signReplica } from './replica.js';

export function makeStandby({ primaryUrl, key, pullMs = 10000, failAfter = 3, primaryName, overrides = {}, port, host, log = console.log }) {
  const cfg = loadConfig(overrides);
  const pki = pkiPaths(cfg.pkiDir);
  if (!fs.existsSync(pki.caKey) || !fs.existsSync(pki.auditKey)) throw new Error(`copy the primary's pki folder to ${pki.dir} first: the standby must use the same certificate authority and signing keys`);
  if (!key) throw new Error('DX_REPLICATION_KEY is required (the same value as on the primary)');
  const url = new URL('/ops/v1/replica/snapshot', primaryUrl);
  const ca = [...tls.rootCertificates, fs.readFileSync(pki.rootCrt, 'utf8'), fs.readFileSync(pki.caCrt, 'utf8')];
  const name = primaryName || cfg.publicName;
  fs.mkdirSync(path.dirname(cfg.dbFile), { recursive: true });
  const st = { primary: url.origin, pulls: 0, failures: 0, lastPull: null, lastError: null, bytes: 0, promoted: null, app: null };
  let timer = null, busy = false;

  function fetchSnapshot(file) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { agent: false, ca, headers: { 'x-dx-replica': signReplica(key) }, timeout: Math.max(5000, pullMs), checkServerIdentity: (h, cert) => tls.checkServerIdentity(name, cert) }, res => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`primary answered HTTP ${res.statusCode}`)); }
        const out = fs.createWriteStream(file, { mode: 0o600 });
        res.pipe(out); out.on('finish', resolve); out.on('error', reject); res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('primary did not answer in time')));
      req.on('error', reject);
    });
  }

  const api = {
    state: st,
    // One pull: download to a side file, check it, then put it in place of the previous copy.
    async pull() {
      const tmp = cfg.dbFile + '.incoming';
      try {
        await fetchSnapshot(tmp);
        const check = verifyBackup(tmp);
        if (check.integrity !== 'ok') throw new Error('snapshot failed the integrity check: ' + check.integrity);
        for (const x of ['-wal', '-shm']) fs.rmSync(cfg.dbFile + x, { force: true });
        fs.renameSync(tmp, cfg.dbFile);
        st.pulls++; st.failures = 0; st.lastPull = iso(Date.now()); st.lastError = null; st.bytes = fs.statSync(cfg.dbFile).size;
        return check;
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        st.failures++; st.lastError = e.message;
        throw e;
      }
    },
    async tick() {
      if (busy || st.promoted) return; busy = true;
      try { await api.pull(); } catch (e) {
        log(`${iso(Date.now())} standby: pull ${st.failures} of ${failAfter} failed: ${e.message}`);
        if (st.failures >= failAfter) await api.promote(`the primary missed ${st.failures} pulls in a row (${e.message})`);
      } finally { busy = false; }
    },
    // Take over: start the full DX on the latest copy.
    async promote(why = 'promoted by hand') {
      if (st.promoted) return st.app;
      if (!st.lastPull && !fs.existsSync(cfg.dbFile)) throw new Error('no copy of the database yet; cannot take over');
      clearInterval(timer); timer = null;
      const { createApp } = await import('../server.js');
      st.app = createApp({ ...overrides, haRole: 'standby (promoted)', leader: true });
      await st.app.listen(port ?? st.app.cfg.port, host ?? st.app.cfg.host);
      st.promoted = iso(Date.now());
      st.app.audit.log('Operations', 'standby', 'Standby promoted to primary', `${why}; data as of ${st.lastPull || 'the copy on disk'}`);
      log(`${st.promoted} standby: promoted to primary (${why}); serving the copy taken at ${st.lastPull || 'unknown time'}`);
      return st.app;
    },
    start() { if (!timer && !st.promoted) { timer = setInterval(() => api.tick(), pullMs); timer.unref?.(); api.tick(); } return api; },
    async stop() { clearInterval(timer); timer = null; if (st.app) await st.app.close(); },
  };
  return api;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (k, d) => process.env[k] || d;
  if (!process.env.DX_PRIMARY_URL) { console.error('Set DX_PRIMARY_URL, for example https://10.0.0.5:8443'); process.exit(1); }
  const sb = makeStandby({
    primaryUrl: env('DX_PRIMARY_URL'), key: env('DX_REPLICATION_KEY'), primaryName: env('DX_PRIMARY_NAME'),
    pullMs: Number(env('DX_PULL_MS', 10000)), failAfter: Number(env('DX_FAILOVER_AFTER', 3)),
  });
  console.log(`Standby for ${sb.state.primary}: pulling every ${Number(env('DX_PULL_MS', 10000)) / 1000} s (demo data)`);
  sb.start();
  setInterval(() => {}, 1 << 30); // keep running while waiting
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await sb.stop(); process.exit(0); });
}
