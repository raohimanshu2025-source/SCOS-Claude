// Front door for the primary and standby servers (BIS 5.6 high availability). It passes TCP connections through
// unchanged, so TLS and client certificates still end at the DX server. Every DX_HEALTH_MS it asks the current
// server for its heartbeat; after DX_FAILOVER_AFTER misses in a row it moves to the next server that answers.
// It never moves back on its own: a primary that comes back has old data, so switching back is a manual step.
// Run on a third small machine (or the one with the public address):
//   DX_FRONTDOOR_TARGETS="10.0.0.5,10.0.0.6" node deploy/ha-frontdoor.js
// Ports: DX_FRONTDOOR_PORTS="443:8443,8883:8883,5671:5671" (listen:target). The first pair is the HTTPS one used for health checks.
import net from 'node:net';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

export function makeFrontDoor({ targets, ports, healthMs = 5000, failAfter = 3, host = '0.0.0.0', log = console.log }) {
  // targets: [{ name, host, ports: { <listen port>: <target port> } }]; ports: [listen port, ...], first = HTTPS
  const st = { active: 0, misses: 0, switches: [], checks: 0 };
  const servers = [], open = new Set();
  let timer = null;

  const health = t => new Promise(resolve => {
    const req = https.get({ agent: false, host: t.host, port: t.ports[ports[0]], path: '/status/v1/heartbeat', rejectUnauthorized: false, timeout: Math.max(2000, healthMs) }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(res.statusCode === 200 && !!JSON.parse(d).services); } catch { resolve(false); } });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(false));
  });

  const api = {
    state: st,
    get active() { return targets[st.active]; },
    async check() {
      st.checks++;
      if (await health(targets[st.active])) { st.misses = 0; return true; }
      st.misses++;
      if (st.misses < failAfter) return false;
      for (let i = st.active + 1; i < targets.length; i++) {
        if (await health(targets[i])) {
          st.switches.push({ at: new Date().toISOString(), from: targets[st.active].name, to: targets[i].name });
          log(`front door: ${targets[st.active].name} missed ${st.misses} health checks; now sending clients to ${targets[i].name}`);
          st.active = i; st.misses = 0; return true;
        }
      }
      return false;
    },
    async listen() {
      for (const lp of ports) {
        const srv = net.createServer(client => {
          const t = targets[st.active];
          const up = net.connect({ host: t.host, port: t.ports[lp] });
          open.add(client); open.add(up);
          client.pipe(up); up.pipe(client);
          const end = () => { client.destroy(); up.destroy(); open.delete(client); open.delete(up); };
          client.on('error', end); up.on('error', end); client.on('close', end); up.on('close', end);
        });
        await new Promise(r => srv.listen(lp, host, r));
        servers.push(srv);
      }
      timer = setInterval(() => api.check(), healthMs); timer.unref?.();
      return servers.map(s => s.address());
    },
    async close() { clearInterval(timer); for (const s of open) s.destroy(); await Promise.all(servers.map(s => new Promise(r => { s.close(() => r()); }))); },
  };
  return api;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (k, d) => process.env[k] || d;
  const pairs = env('DX_FRONTDOOR_PORTS', '443:8443,8883:8883,5671:5671').split(',').map(p => p.split(':').map(Number));
  const hosts = env('DX_FRONTDOOR_TARGETS', '').split(',').map(s => s.trim()).filter(Boolean);
  if (hosts.length < 2) { console.error('Set DX_FRONTDOOR_TARGETS to the primary and standby addresses, for example "10.0.0.5,10.0.0.6"'); process.exit(1); }
  const fd = makeFrontDoor({
    ports: pairs.map(p => p[0]), healthMs: Number(env('DX_HEALTH_MS', 5000)), failAfter: Number(env('DX_FAILOVER_AFTER', 3)),
    targets: hosts.map((h, i) => ({ name: i === 0 ? `primary ${h}` : `standby ${h}`, host: h, ports: Object.fromEntries(pairs.map(([l, t]) => [l, t])) })),
  });
  await fd.listen();
  console.log(`Front door on ports ${pairs.map(p => p[0]).join(', ')}; sending clients to ${fd.active.name} (demo data)`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await fd.close(); process.exit(0); });
}
