// HTTPS server wiring every service together. Run: node src/server.js (after npm run certs && npm run seed).
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { openDb, q } from './db.js';
import { makeAudit } from './audit.js';
import { initPki, pkiPaths } from './identity/ca.js';
import { makeIdentity, actorOf, externalCas } from './identity/identity.js';
import { makeAccounts, ROLES } from './identity/accounts.js';
import { makeNotify } from './dx/notify.js';
import { makeCatalogue } from './dx/catalogue.js';
import { makeAuthz } from './dx/authz.js';
import { makeResource } from './dx/resource.js';
import { dataModelDoc, contextDoc, baseSchema, MODELS, MANDATORY, T3, T3_NAMES, TABLE4, TABLE4_ROWS, LABEL_DEFAULTS, LABEL_CLASSES } from './dx/model.js';
import { CLASS_TEXT } from './identity/ca.js';
import { makeCil } from './cil/cil.js';
import { makeOps, serviceOfPath, backupDb, listBackups, securityHeaders, makeRateLimiter } from './ops/ops.js';
import { simulateTick } from './simulate.js';
import { HttpError, fail, need, readBody, iso } from './util.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.pdf': 'application/pdf' };

export function createApp(overrides = {}) {
  const cfg = loadConfig(overrides);
  const pki = initPki(cfg.pkiDir, { publicName: cfg.publicName });
  const db = openDb(cfg.dbFile);
  const audit = makeAudit(db, fs.readFileSync(pki.auditKey, 'utf8'));
  const identity = makeIdentity(db, cfg, audit);
  const accounts = makeAccounts(db, cfg, audit);
  const notify = makeNotify(db, audit);
  const catalogue = makeCatalogue(db, audit, notify);
  const authz = makeAuthz(db, cfg, audit, catalogue, notify);
  const resource = makeResource(db, cfg, audit, catalogue, authz);
  const cil = makeCil(db, cfg, audit, catalogue, authz, resource, identity);
  const ops = makeOps(db, cfg, audit, { authz, notify, cil, resource, catalogue });
  const limit = makeRateLimiter(cfg.rateLimitPerMin);
  const parts = { cfg, db, audit, identity, accounts, notify, catalogue, authz, resource, cil, ops };

  const routes = [];
  const R = (method, pattern, fn) => routes.push({ method, pattern, fn });
  const role = (p, ...rs) => need(rs.includes(p.role), p.role === 'anonymous' ? 401 : 403, `this needs one of these roles: ${rs.join(', ')}`);
  // BIS Figure 2 step 6 sends "Authorization: IUDX <token>"; the token header and DX / Bearer schemes are also accepted.
  const tokenOf = req => { const h = req.headers; const m = String(h.authorization || '').match(/^(IUDX|DX|Bearer)\s+(\S+)$/i); return h.token || (m ? m[2] : null); };

  // ---- identity and accounts ----
  R('POST', '/auth/v1/login', async c => {
    const b = c.body; const r = accounts.login(b.username, b.password, c.ip);
    c.res.setHeader('Set-Cookie', `dx_session=${r.sid}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${cfg.sessionTtlSec}`);
    return { csrf: r.csrf, mustChange: r.mustChange, user: accounts.get(b.username) };
  });
  R('POST', '/auth/v1/logout', c => { accounts.logout(c.sid, actorOf(c.p)); c.res.setHeader('Set-Cookie', 'dx_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'); return { ok: true }; });
  R('GET', '/auth/v1/me', c => ({ principal: c.p, csrf: c.session?.csrf ?? null, account: c.p.username ? accounts.get(c.p.username) : null, roles: ROLES }));
  R('POST', '/auth/v1/password', c => { need(c.p.username, 401, 'log in first'); accounts.changePassword(c.p.username, c.body.old, c.body.new); c.res.setHeader('Set-Cookie', 'dx_session=; Path=/; Max-Age=0'); return { ok: true, note: 'log in again with the new password' }; });
  R('GET', '/identity/v1/orgs', () => identity.orgs());
  R('POST', '/identity/v1/orgs', c => { role(c.p, 'admin'); return identity.registerOrg(c.body, actorOf(c.p)); });
  R('POST', '/identity/v1/orgs/whitelist', c => { role(c.p, 'admin'); identity.setWhitelist(c.body.id, !!c.body.on, actorOf(c.p)); return identity.orgs(); });
  R('POST', '/identity/v1/csr', c => identity.submitCsr(c.body, actorOf(c.p)));
  R('GET', '/identity/v1/csr/status', c => identity.csrStatus(c.query.id));
  // The administrator sees every request; an organisation (acting as registration authority, BIS 5.4.2) sees its employees'.
  R('GET', '/identity/v1/csr', c => { role(c.p, 'admin', 'auditor', 'organisation'); return identity.csrRequests(c.query.status, c.p.role === 'organisation' ? c.p.orgId : null); });
  R('POST', '/identity/v1/csr/decide', c => { role(c.p, 'admin', 'organisation'); return identity.decideCsr(c.body.id, !!c.body.approve, actorOf(c.p), c.body.reason, c.p.role === 'organisation' ? c.p.orgId : null); });
  R('GET', '/identity/v1/certs', c => { role(c.p, 'admin', 'auditor'); return identity.certs(); });
  R('POST', '/identity/v1/certs/revoke', c => {
    const cert = identity.certBySerial(c.body.serial);
    need(c.p.role === 'admin' || (cert && cert.serial === c.p.serial), 403, 'administrators, or the holder for their own certificate');
    identity.revoke(c.body.serial, c.body.reason, actorOf(c.p)); return identity.certStatus(c.body.serial);
  });
  R('GET', '/identity/v1/certs/status', c => identity.certStatus(String(c.query.serial || '')));
  R('GET', '/identity/v1/crl.pem', c => { c.raw = { type: 'application/x-pem-file', body: identity.crl().pem }; });
  R('GET', '/identity/v1/crl', () => { const x = identity.crl(); return { revokedSerials: x.revokedSerials, lastUpdate: x.lastUpdate, nextUpdate: x.nextUpdate }; });
  R('GET', '/identity/v1/trusted-cas', () => ({ note: 'Certificate authorities this DX accepts for client TLS (BIS 5.1).', cas: identity.trustedCas(), classes: CLASS_TEXT }));
  R('GET', '/identity/v1/accounts', c => { role(c.p, 'admin', 'auditor'); return accounts.list(); });
  R('POST', '/identity/v1/accounts', c => { role(c.p, 'admin'); return accounts.create({ ...c.body, mustChange: true }, actorOf(c.p)); });
  R('POST', '/identity/v1/accounts/unlock', c => { role(c.p, 'admin'); accounts.unlock(c.body.username, actorOf(c.p)); return { ok: true }; });

  // ---- catalogue (Discover, Manage) ----
  // Discover events are written to the audit log too (BIS 5.5: all interfaces log all events).
  const discovered = (c, what, detail) => audit.log('Discover', actorOf(c.p), what, detail);
  R('GET', '/catalogue/v1/search', c => { const r = catalogue.search(c.query); discovered(c, 'Search', `${new URLSearchParams(c.query)} -> ${r.total} item(s)`); return r; });
  R('GET', '/catalogue/v1/count', c => { const n = catalogue.count(c.query); discovered(c, 'Count', `${new URLSearchParams(c.query)} -> ${n}`); return { count: n }; });
  R('GET', '/catalogue/v1/list', c => { const r = catalogue.all(c.query.type).map(i => i.id); discovered(c, 'List', `${c.query.type || 'all'} -> ${r.length}`); return r; });
  R('GET', '/catalogue/v1/items', c => { const d = catalogue.doc(String(c.query.id || '')); need(d, 404, 'no such item'); discovered(c, 'View', d.id); return d; });
  R('POST', '/catalogue/v1/items', c => { const d = catalogue.create(c.body.item, c.p, c.body.data).doc; c.status = 201; return d; }); // Figure 7: 201 Created
  R('PUT', '/catalogue/v1/items', c => catalogue.update(String(c.query.id || ''), c.body.item, c.p).doc);
  R('DELETE', '/catalogue/v1/items', c => { catalogue.remove(String(c.query.id || ''), c.p); return { deleted: c.query.id }; });
  R('GET', '/catalogue/v1/datamodels', c => { if (!c.query.name) return Object.keys(MODELS); const d = dataModelDoc(c.query.name); need(d, 404, 'no such data model'); return d; });
  R('GET', '/catalogue/v1/context', c => { const d = contextDoc(String(c.query.name || '')); need(d, 404, 'contexts: core, common'); return d; });
  R('GET', '/catalogue/v1/schemas', c => { if (!c.query.type) return Object.keys(MANDATORY); const d = baseSchema(String(c.query.type)); need(d, 404, 'no such item type'); return d; });
  R('GET', '/catalogue/v1/policy-vocabulary', () => ({ table3: T3, table3Names: T3_NAMES, table4: TABLE4, table4Rows: TABLE4_ROWS, labelDefaults: LABEL_DEFAULTS, labelClasses: LABEL_CLASSES }));
  R('POST', '/catalogue/v1/watch', c => { need(c.p.email, 401, 'identity required'); need(catalogue.exists(c.body.id), 404, 'no such item'); notify.watch(c.p.email, c.body.id); return { watching: c.body.id }; });
  R('DELETE', '/catalogue/v1/watch', c => { need(c.p.email, 401, 'identity required'); notify.unwatch(c.p.email, c.query.id); return { ok: true }; });
  R('GET', '/catalogue/v1/status', () => ({ service: 'catalogue', status: 'up', items: catalogue.stats(), ts: iso(Date.now()) }));

  // ---- authorization, consent, policy ----
  R('POST', '/auth/v1/token', c => authz.requestToken(c.p, c.body.request, c.body.purpose));
  R('POST', '/auth/v1/token/introspect', c => {
    const r = authz.introspect(c.p, c.body.token, c.body.id, { useCache: false });
    need(r.ok, 403, 'invalid token: ' + r.reason); return r.body;
  });
  R('POST', '/auth/v1/token/revoke', c => { need(c.p.email, 401, 'identity required'); return authz.revoke(c.p, c.body); });
  R('GET', '/auth/v1/token/list', c => { need(c.p.email, 401, 'identity required'); return authz.myTokens(c.p.email); });
  R('GET', '/auth/v1/acl', c => authz.getPolicy(String(c.query.id || ''), c.p));
  // Table 2 Manage: create, update, delete and view access control policies (Figure 8 step 4 uses POST)
  R('PUT', '/auth/v1/acl', c => authz.setPolicy(String(c.query.id || c.body.id || ''), c.body, c.p));
  R('POST', '/auth/v1/acl', c => authz.setPolicy(String(c.query.id || c.body.id || ''), c.body, c.p));
  R('POST', '/auth/1.0/acl', c => authz.setPolicy(String(c.query.id || c.body.id || ''), c.body, c.p)); // path exactly as printed in Figure 8 step 4
  R('DELETE', '/auth/v1/acl', c => authz.resetPolicy(String(c.query.id || ''), c.p));
  // Table 2 Manage: list and view information about consumers
  R('GET', '/auth/v1/consumers', c => authz.consumers(c.p, c.query.email));
  R('GET', '/auth/v1/consent', c => { need(c.p.email, 401, 'identity required'); return authz.consents(c.p, c.query); });
  R('POST', '/auth/v1/consent/decide', c => authz.decideConsent(c.body.id, !!c.body.approve, c.p));
  R('GET', '/auth/v1/flows', c => authz.flows(c.p));
  R('POST', '/auth/v1/licence', c => authz.addLicence(c.body.id, c.body, c.p));
  R('DELETE', '/auth/v1/licence', c => { authz.removeLicence(c.query.id, c.query.app, c.p); return { ok: true }; });
  R('GET', '/auth/v1/licence', c => authz.licences(c.query.id));
  R('GET', '/auth/v1/status', () => ({ service: 'authorization', status: authz.state.up ? 'up' : 'down', ts: iso(Date.now()) }));

  // ---- resources ----
  for (const op of ['latest', 'search', 'status', 'count', 'download']) R('GET', '/resource/v1/' + op, c => resource.read(c.p, op, c.query, tokenOf(c.req)));
  R('POST', '/resource/v1/subscription', c => resource.subscribe(c.p, c.body, tokenOf(c.req)));
  R('PATCH', '/resource/v1/subscription', c => resource.updateSub(c.p, c.body));
  R('DELETE', '/resource/v1/subscription', c => { resource.unsubscribe(c.p, c.query.sid); return { ok: true }; });
  R('GET', '/resource/v1/subscription/stream', c => { c.stream = true; startStream(c); });
  R('POST', '/resource/v1/ingest', c => resource.ingest(c.p, c.body));
  R('GET', '/resource/v1/servers', () => [...resource.localServers().values()].map(s => ({ id: s.id, host: s.host, legacy: s.legacy, up: resource.serverUp(s.id) })));

  // ---- notifications ----
  R('GET', '/notify/v1/inbox', c => { need(c.p.email, 401, 'identity required'); return notify.inbox(c.p.email); });
  R('GET', '/notify/v1/history', c => { need(c.p.email, 401, 'identity required'); return notify.history(c.p.email); });

  // ---- City Intelligence Layer ----
  const pub = a => { const { run, defaults, ...rest } = a; return rest; };
  R('GET', '/cil/v1/apis', () => cil.list().map(pub));
  R('GET', '/cil/v1/openapi', c => { const a = cil.list().find(x => x.path === c.query.path); need(a, 404, 'no such API'); return cil.openapi(a); });
  R('GET', '/cil/v1/ontology', () => cil.ontology());
  R('POST', '/cil/v1/analytics', c => pub(cil.register(c.p, c.body)));
  R('DELETE', '/cil/v1/analytics', c => { cil.unregister(c.p, c.query.id); return { ok: true }; });
  R('GET', '/cil/v1/alerts', c => cil.alerts(c.query.limit));
  R('POST', '/cil/v1/olap', c => cil.olap(c.p, c.body));
  R('POST', '/cil/v1/ask', c => cil.ask(c.p, c.body.question));
  R('GET', '/cil/v1/report', c => { role(c.p, 'operator', 'admin', 'auditor'); return cil.report(c.p, c.query.month); });
  R('POST', '/cil/v1/federate', c => cil.federate(c.p, c.body.path, c.body.body));
  R('POST', /^\/cil\/v1(\/[a-z]+\/[A-Za-z]+)$/, (c, m) => cil.call(c.p, m[1], c.body, { format: c.query.format }));

  // ---- operations ----
  R('GET', '/status/v1', c => ops.status(Math.min(24 * 30, Number(c.query.hours) || 24)));
  R('GET', '/status/v1/heartbeat', () => ops.heartbeat());
  R('GET', '/ops/v1/stats', c => { role(c.p, 'admin', 'auditor'); return ops.stats(); });
  R('GET', '/ops/v1/audit', c => {
    role(c.p, 'admin', 'auditor');
    const lim = Math.min(1000, Number(c.query.limit) || 200);
    const where = [], args = [];
    if (c.query.iface) { where.push('iface=?'); args.push(c.query.iface); }
    if (c.query.actor) { where.push('actor=?'); args.push(c.query.actor); }
    return q.all(db, `SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY seq DESC LIMIT ?`, ...args, lim);
  });
  R('GET', '/ops/v1/audit/verify', c => { role(c.p, 'admin', 'auditor'); return audit.verify(); });
  R('GET', '/ops/v1/audit/public-key', () => ({ alg: 'Ed25519', publicKeyPem: audit.publicKeyPem }));
  R('POST', '/ops/v1/backup', c => { role(c.p, 'admin'); const b = backupDb(db, cfg.backupDir, c.body.label || 'manual'); audit.log('Operations', actorOf(c.p), 'Backup taken', path.basename(b.file)); return { ...b, file: path.basename(b.file) }; });
  R('GET', '/ops/v1/backups', c => { role(c.p, 'admin'); return listBackups(cfg.backupDir); });
  R('POST', '/ops/v1/service', c => {
    role(c.p, 'admin'); const { service, up } = c.body;
    if (service === 'authorization') authz.setUp(up, actorOf(c.p));
    else if (service === 'notification') notify.setUp(up, actorOf(c.p));
    else if (service === 'cil') cil.setUp(up, actorOf(c.p));
    else if (String(service).startsWith('urn:')) resource.setServerUp(service, up, actorOf(c.p));
    else fail(400, 'service must be authorization, notification, cil or a resource server id');
    ops.beat(); return ops.heartbeat();
  });
  R('GET', '/api', () => ({ name: 'City OS data exchange reference implementation', city: cfg.cityName, note: 'Research reference implementation with synthetic demo data. Not an official, certified or live system.', routes: routes.map(r => `${r.method} ${r.pattern instanceof RegExp ? '/cil/v1/{domain}/{api}' : r.pattern}`) }));

  // ---- server-sent events for subscriptions ----
  function startStream(c) {
    const sub = resource.getSub(String(c.query.sid || ''), c.p);
    const token = tokenOf(c.req);
    let since = Date.now() - 1;
    const first = resource.poll(c.p, sub, token, 0).at(-1); // throws if access no longer valid
    c.res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    if (first) c.res.write(`event: packet\ndata: ${JSON.stringify(first)}\n\n`);
    const iv = setInterval(() => {
      try {
        const s = q.get(db, 'SELECT every_sec, active FROM subscriptions WHERE id=?', sub.id);
        if (!s?.active) { c.res.write('event: end\ndata: {"reason":"unsubscribed"}\n\n'); return stop(); }
        const rows = resource.poll(c.p, sub, token, since);
        for (const r of rows) c.res.write(`event: packet\ndata: ${JSON.stringify(r)}\n\n`);
        c.res.write(': keep-alive\n\n'); since = Date.now();
      } catch (e) { c.res.write(`event: end\ndata: ${JSON.stringify({ reason: e.message })}\n\n`); stop(); }
    }, sub.every_sec * 1000);
    const stop = () => { clearInterval(iv); c.res.end(); };
    c.req.on('close', () => clearInterval(iv));
  }

  // ---- request handling ----
  async function handle(req, res) {
    const t0 = performance.now();
    const url = new URL(req.url, 'https://' + (req.headers.host || cfg.publicName));
    const ip = req.socket.remoteAddress;
    const c = { req, res, url, ip, query: Object.fromEntries(url.searchParams), body: {} };
    securityHeaders(res);
    let status = 200;
    try {
      limit(ip);
      if (req.method === 'GET' && !url.pathname.match(/^\/(auth|catalogue|resource|notify|cil|status|ops|identity|api)(\/|$)/)) return serveStatic(url.pathname, res);
      const cookie = Object.fromEntries(String(req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(x => x[0]));
      c.sid = cookie.dx_session; c.session = accounts.session(c.sid);
      c.p = identity.principal(req, c.session);
      if (c.p.via === 'session' && !['GET', 'HEAD'].includes(req.method) && url.pathname !== '/auth/v1/login') need(req.headers['x-csrf-token'] === c.session.csrf, 403, 'missing or wrong CSRF token');
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) c.body = await readBody(req);
      const hit = routes.map(r => ({ r, m: r.method === req.method && (r.pattern instanceof RegExp ? url.pathname.match(r.pattern) : r.pattern === url.pathname ? [url.pathname] : null) })).find(x => x.m);
      need(hit, 404, `no route ${req.method} ${url.pathname}`);
      const out = await hit.r.fn(c, hit.m);
      if (c.stream) return;
      if (c.raw) { res.writeHead(200, { 'content-type': c.raw.type }); return res.end(c.raw.body); }
      status = c.status || 200; send(res, status, out ?? { ok: true });
    } catch (e) {
      status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (status === 401 && !res.headersSent) res.setHeader('WWW-Authenticate', `DX realm="${cfg.publicName}", as_uri="https://${cfg.authHost}/auth/v1/token"`);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'internal error' : e.message, status, ...(e.extra || {}) });
      else res.end();
    } finally {
      const svc = serviceOfPath(url.pathname);
      if (svc && !c.stream) try { ops.recordCall(svc, url.pathname, status, performance.now() - t0); } catch { /* never fail a request on metrics */ }
      if (cfg.logRequests) console.log(`${iso(Date.now())} ${req.method} ${url.pathname} ${status} ${Math.round(performance.now() - t0)}ms`);
    }
  }
  function send(res, status, obj) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); }
  function serveStatic(p, res) {
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    const file = path.resolve(cfg.staticDir, rel);
    if (!file.startsWith(cfg.staticDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  const server = https.createServer({
    key: fs.readFileSync(pki.serverKey), cert: fs.readFileSync(pki.serverCrt) + fs.readFileSync(pki.caCrt),
    ca: [fs.readFileSync(pki.rootCrt), fs.readFileSync(pki.caCrt), ...externalCas(cfg).map(x => x.toString())],
    requestCert: cfg.requestClientCert, rejectUnauthorized: false, // unauthorised peers are refused per request with a clear message
    minVersion: 'TLSv1.2',
  }, (req, res) => { handle(req, res); });

  let simTimer = null;
  return {
    ...parts, server, routes,
    listen(port = cfg.port, host = cfg.host) {
      return new Promise(r => server.listen(port, host, () => {
        ops.start(); cil.start();
        if (cfg.simulator) { simTimer = setInterval(() => { try { simulateTick(parts); } catch (e) { console.error('simulator', e.message); } }, cfg.simulatorMs); simTimer.unref(); }
        r(server.address());
      }));
    },
    close() { ops.stop(); cil.stop(); clearInterval(simTimer); server.closeAllConnections?.(); return new Promise(r => server.close(() => { db.close(); r(); })); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  if (!q.get(app.db, 'SELECT 1 FROM accounts LIMIT 1')) { console.error('No accounts yet. Run: npm run seed'); process.exit(1); }
  const a = await app.listen();
  console.log(`City OS DX reference implementation for ${app.cfg.cityName} on https://${a.address}:${a.port} (demo data)`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.close(); process.exit(0); });
}
export { pkiPaths };
