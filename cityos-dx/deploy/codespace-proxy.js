// Codespaces only: plain-HTTP front door on port 8080 for the demo server on https://127.0.0.1:8443.
// GitHub's port forwarding gives the public HTTPS link and talks plain HTTP to this port, so no
// "port protocol" setting is needed. Browser logins work through it; client-certificate (mutual TLS)
// API calls do not pass through the Codespaces link.
import http from 'node:http';
import https from 'node:https';

const target = Number(process.env.DX_PORT || 8443), port = Number(process.env.DX_PROXY_PORT || 8080);
http.createServer((req, res) => {
  const headers = { ...req.headers, 'x-forwarded-proto': 'https' };
  const up = https.request({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers,
    rejectUnauthorized: false }, r => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  up.on('error', e => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('Demo server is not running yet: ' + e.message); });
  req.pipe(up);
}).listen(port, '0.0.0.0', () => console.log(`Codespaces front door on port ${port} -> https://127.0.0.1:${target}`));
