// External uptime probe: calls the public heartbeat and exits non-zero if the server or a service is down.
// Run it from another machine every minute (cron, systemd timer or any monitoring tool) and alert on failure.
// Usage: DX_URL=https://dx.example:8443 DX_CA_FILE=pki/root/root.crt node scripts/uptime-check.js
import https from 'node:https';
import fs from 'node:fs';
const url = new URL('/status/v1/heartbeat', process.env.DX_URL || 'https://localhost:8443');
const ca = process.env.DX_CA_FILE ? fs.readFileSync(process.env.DX_CA_FILE) : undefined;
const t0 = Date.now();
const req = https.get(url, { ca, timeout: 10000 }, res => {
  let d = ''; res.on('data', c => (d += c));
  res.on('end', () => {
    const ms = Date.now() - t0;
    try {
      const j = JSON.parse(d); const down = Object.entries(j.services).filter(([, v]) => v !== 'up').map(([k]) => k);
      console.log(`${new Date().toISOString()} ${res.statusCode} ${ms}ms ${down.length ? 'DOWN: ' + down.join(',') : 'all services up'}`);
      process.exit(res.statusCode === 200 && !down.length ? 0 : 1);
    } catch { console.log(`${new Date().toISOString()} bad response ${res.statusCode}`); process.exit(1); }
  });
});
req.on('timeout', () => req.destroy(new Error('timeout')));
req.on('error', e => { console.log(`${new Date().toISOString()} UNREACHABLE ${e.message}`); process.exit(1); });
