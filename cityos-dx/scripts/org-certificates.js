// Certificate script for organisations (BIS 5.4.2: "the scripts to grant certificates may be provided by the DX to organizations").
// A department, acting as registration authority for its own staff, lists its employees' certificate requests and
// approves or rejects them, using its organisation certificate over mutual TLS. Nothing else can be done with it.
// Usage:
//   DX_URL=https://dx.example:8443 DX_CA_FILE=root.crt ORG_CERT=org.crt ORG_KEY=org.key node scripts/org-certificates.js list
//   ... node scripts/org-certificates.js approve <request id>
//   ... node scripts/org-certificates.js reject <request id> "reason"
import https from 'node:https';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function orgCertificates({ url, ca, cert, key, servername }, action, id, reason) {
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const u = new URL(path, url);
    const r = https.request(u, { method, ca, cert, key, servername, headers: body ? { 'content-type': 'application/json' } : {} }, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => { let j; try { j = JSON.parse(d); } catch { j = d; } (res.statusCode < 300 ? resolve : reject)(Object.assign(new Error(j?.error || String(res.statusCode)), { status: res.statusCode, body: j, result: j })); });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  }).then(e => e.result ?? e);
  if (action === 'list') return call('GET', '/identity/v1/csr?status=pending');
  if (action === 'approve' || action === 'reject') {
    if (!id) return Promise.reject(new Error('give the request id'));
    return call('POST', '/identity/v1/csr/decide', { id, approve: action === 'approve', reason });
  }
  return Promise.reject(new Error('action must be list, approve or reject'));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, id, reason] = process.argv.slice(2);
  const env = process.env;
  orgCertificates({ url: env.DX_URL || 'https://localhost:8443', ca: env.DX_CA_FILE && fs.readFileSync(env.DX_CA_FILE), cert: fs.readFileSync(env.ORG_CERT), key: fs.readFileSync(env.ORG_KEY), servername: env.DX_TLS_SERVERNAME }, action, id, reason)
    .then(r => {
      if (action === 'list') { if (!r.length) console.log('No pending requests.'); for (const x of r) console.log(`${x.id}\t${x.email}\tclass ${x.cls}\t${x.kind}\t${x.created_at}`); }
      else console.log(`${id}: ${r.status}${r.cert_serial ? ', certificate ' + r.cert_serial : ''}`);
    })
    .catch(e => { console.error('Failed:', e.message); process.exit(1); });
}
