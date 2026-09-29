// Identity service: organisations and white-list, the certificate request process, revocation, and
// working out who is calling (BIS 4.4, 5.3, 5.4.2).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { q, tx } from '../db.js';
import { iso, fail, need, randHex, str } from '../util.js';
import * as ca from './ca.js';

export const CERT_KINDS = {
  rs: { label: 'Resource server', classes: [1], needsOrg: true },
  org: { label: 'Organisation', classes: [2, 3, 4, 5], needsOrg: true },
  officer: { label: 'Data officer', classes: [3], needsOrg: true, needsOrgCert: true },
  emp: { label: 'Employee', classes: [2, 4, 5], needsOrg: true, needsOrgCert: true },
  ind: { label: 'Individual / app developer', classes: [2], needsOrg: false },
};
const DNS = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function makeIdentity(db, cfg, audit) {
  const orgOfDomain = domain => q.all(db, 'SELECT * FROM orgs').find(o => domain === o.domain || domain.endsWith('.' + o.domain)) || null;

  function recordCert(c, { cls, kind, orgId }) {
    q.run(db, `INSERT INTO certs (serial, cn, email, org_id, cls, kind, dn, pem, fingerprint, not_after, status, issued_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'valid', ?)`,
      c.serial, c.cn, c.email, orgId, cls, kind, c.dn, c.pem, c.fingerprint, c.notAfter, iso(Date.now()));
    return certBySerial(c.serial);
  }
  const certBySerial = s => q.get(db, 'SELECT * FROM certs WHERE serial=?', String(s || '').toUpperCase());

  // Checks a request against the BIS 5.4.2 rules. Returns { org } or throws with the reason.
  function checkRequest({ subject, cn, email, cls, kind }) {
    need(/^certificate request$/i.test(str(subject)), 400, 'the subject must be "Certificate request" (BIS 5.4.2)');
    const k = CERT_KINDS[kind]; need(k, 400, 'kind must be one of ' + Object.keys(CERT_KINDS).join(', '));
    need(k.classes.includes(cls), 400, `a ${k.label} certificate can be class ${k.classes.join(' or ')}, not ${cls} (BIS 5.4.2)`);
    need(email && email.includes('@'), 400, 'the request must carry an emailAddress in its subject');
    const domain = email.split('@')[1];
    const org = orgOfDomain(domain);
    if (k.needsOrg) {
      need(org, 403, `no registered organisation owns the domain ${domain} (BIS 5.4.2: organisations register first)`);
      need(org.whitelisted, 403, `organisation ${org.name} is not on the white-list (BIS 5.4.2)`);
    }
    if (k.needsOrgCert) {
      const oc = q.get(db, `SELECT serial FROM certs WHERE org_id=? AND kind='org' AND status='valid'`, org.id);
      need(oc, 403, `organisation ${org.name} holds no valid organisation certificate, so it cannot have employee certificates (BIS 5.4.2)`);
    }
    if (kind === 'rs') need(DNS.test(cn) && (cn === org.domain || cn.endsWith('.' + org.domain)), 400, `a resource server certificate needs a DNS name under ${org.domain} as its CN`);
    return { org };
  }

  return {
    certBySerial,
    orgs: () => q.all(db, 'SELECT * FROM orgs ORDER BY name'),
    registerOrg({ id, name, domain, whitelisted = false }, by) {
      need(/^[a-z0-9-]{2,32}$/.test(id || ''), 400, 'org id must be 2-32 lowercase letters, digits or -');
      need(str(name), 400, 'name required'); need(DNS.test(domain || ''), 400, 'domain must be a DNS name');
      need(!q.get(db, 'SELECT 1 FROM orgs WHERE id=? OR domain=?', id, domain), 409, 'organisation or domain already registered');
      q.run(db, 'INSERT INTO orgs (id, name, domain, whitelisted, created_at) VALUES (?,?,?,?,?)', id, str(name, 200), domain.toLowerCase(), whitelisted ? 1 : 0, iso(Date.now()));
      audit.log('Identity', by, 'Organisation registered', `${id} ${domain}${whitelisted ? ' white-listed' : ''}`);
      return q.get(db, 'SELECT * FROM orgs WHERE id=?', id);
    },
    setWhitelist(id, on, by) {
      need(q.get(db, 'SELECT 1 FROM orgs WHERE id=?', id), 404, 'no such organisation');
      q.run(db, 'UPDATE orgs SET whitelisted=? WHERE id=?', on ? 1 : 0, id);
      audit.log('Identity', by, on ? 'Organisation white-listed' : 'Organisation removed from white-list', id);
    },

    // Stands in for the e-mail to the DX CA (BIS 7.1, Figure 6): the request is checked now and waits for an administrator.
    submitCsr({ subject, csr, cls, kind }, by = 'anonymous') {
      cls = Number(cls);
      let parsed; try { parsed = ca.readCsr(csr); } catch (e) { fail(400, e.message); }
      let org;
      try { ({ org } = checkRequest({ subject, ...parsed, cls, kind })); }
      catch (e) { audit.log('Identity', by, 'Certificate request refused', `${parsed.email}: ${e.message}`, false); throw e; }
      const id = 'CSR-' + randHex(4).toUpperCase();
      q.run(db, `INSERT INTO csr_requests (id, subject, csr, cn, email, cls, kind, org_id, status, created_at) VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`,
        id, 'Certificate request', csr, parsed.cn, parsed.email, cls, kind, org?.id ?? null, iso(Date.now()));
      audit.log('Identity', by, 'Certificate request received', `${id} ${parsed.email} class ${cls} ${kind}`);
      return { id, status: 'pending', cn: parsed.cn, email: parsed.email, cls, kind };
    },
    csrRequests: (status) => q.all(db, `SELECT id, cn, email, cls, kind, org_id, status, reason, cert_serial, created_at, decided_at, decided_by FROM csr_requests ${status ? 'WHERE status=?' : ''} ORDER BY created_at DESC`, ...(status ? [status] : [])),
    csrStatus(id) {
      const r = q.get(db, 'SELECT id, email, cls, kind, status, reason, cert_serial FROM csr_requests WHERE id=?', id);
      need(r, 404, 'no such request');
      if (r.cert_serial) r.certificate = certBySerial(r.cert_serial).pem;
      return r;
    },
    decideCsr(id, approve, by, reason = '') {
      const r = q.get(db, 'SELECT * FROM csr_requests WHERE id=?', id);
      need(r, 404, 'no such request'); need(r.status === 'pending', 409, 'request already ' + r.status);
      if (!approve) {
        q.run(db, `UPDATE csr_requests SET status='rejected', reason=?, decided_at=?, decided_by=? WHERE id=?`, str(reason) || 'rejected by administrator', iso(Date.now()), by, id);
        audit.log('Identity', by, 'Certificate request rejected', id);
        return this.csrStatus(id);
      }
      checkRequest({ subject: r.subject, cn: r.cn, email: r.email, cls: r.cls, kind: r.kind }); // rules may have changed since submission
      const c = ca.signCsr(cfg.pkiDir, r.csr, r.cls);
      tx(db, () => {
        recordCert(c, { cls: r.cls, kind: r.kind, orgId: r.org_id });
        q.run(db, `UPDATE csr_requests SET status='issued', cert_serial=?, decided_at=?, decided_by=? WHERE id=?`, c.serial, iso(Date.now()), by, id);
      });
      audit.log('Identity', by, 'Certificate issued', `${id} serial ${c.serial} ${c.email} class ${r.cls}`);
      return this.csrStatus(id);
    },
    // Direct issue with a generated key (seed script and demo holders only).
    issueDirect({ cn, email, cls, kind }, by = 'seed') {
      const org = orgOfDomain(email.split('@')[1]);
      checkRequest({ subject: 'Certificate request', cn, email, cls, kind });
      const c = ca.issueKeyAndCert(cfg.pkiDir, { cn, email, org: org?.name, cls });
      recordCert(c, { cls, kind, orgId: org?.id ?? null });
      audit.log('Identity', by, 'Certificate issued', `serial ${c.serial} ${email} class ${cls} ${kind}`);
      return c;
    },
    revoke(serial, reason, by) {
      const c = certBySerial(serial); need(c, 404, 'no such certificate');
      need(c.status === 'valid', 409, 'certificate already ' + c.status);
      ca.revokeCert(cfg.pkiDir, c.serial, reason);
      q.run(db, `UPDATE certs SET status='revoked', revoked_at=?, revoke_reason=? WHERE serial=?`, iso(Date.now()), reason || 'unspecified', c.serial);
      // tokens issued to this certificate stop working at once
      q.run(db, 'UPDATE tokens SET revoked_at=? WHERE cert_serial=? AND revoked_at IS NULL', iso(Date.now()), c.serial);
      audit.log('Identity', by, 'Certificate revoked', `serial ${c.serial} ${c.email} reason ${reason || 'unspecified'}`);
    },
    certs: () => q.all(db, 'SELECT serial, cn, email, org_id, cls, kind, dn, fingerprint, not_after, status, revoked_at, revoke_reason, issued_at FROM certs ORDER BY issued_at'),
    certStatus(serial) {
      const c = certBySerial(serial);
      if (!c) return { serial, status: 'unknown' };
      const expired = Date.parse(c.not_after) < Date.now();
      return { serial: c.serial, status: expired ? 'expired' : c.status, revokedAt: c.revoked_at, reason: c.revoke_reason, notAfter: c.not_after, cls: c.cls, producedAt: iso(Date.now()) };
    },
    crl: () => ca.crlInfo(cfg.pkiDir),
    trustedCas() {
      const p = ca.pkiPaths(cfg.pkiDir);
      return [p.rootCrt, p.caCrt].map(f => { const d = ca.describeCert(fs.readFileSync(f, 'utf8')); return { subject: d.dn, issuer: d.issuer, fingerprint: d.fingerprint, notAfter: d.notAfter, pem: d.pem }; });
    },

    // Who is calling. Order: TLS client certificate, then OpenID Connect ID token, then console session.
    principal(req, session) {
      const sock = req.socket;
      const peer = typeof sock.getPeerCertificate === 'function' ? sock.getPeerCertificate() : null;
      if (peer && peer.serialNumber) {
        if (!sock.authorized) fail(401, 'client certificate is not from a trusted CA: ' + sock.authorizationError);
        const c = certBySerial(peer.serialNumber);
        need(c && c.fingerprint === peer.fingerprint256, 401, 'client certificate is not registered with this DX');
        need(c.status === 'valid', 403, `certificate ${c.serial} is revoked (BIS 5.3)`);
        need(Date.parse(c.not_after) > Date.now(), 403, 'certificate expired');
        const acct = q.get(db, 'SELECT username, role FROM accounts WHERE cert_serial=?', c.serial);
        return { via: 'certificate', email: c.email, cn: c.cn, cls: c.cls, serial: c.serial, dn: c.dn, kind: c.kind, orgId: c.org_id, role: acct?.role ?? roleOfKind(c), username: acct?.username ?? null };
      }
      const idt = req.headers['x-id-token'];
      if (idt) {
        const claims = verifyIdToken(String(idt), cfg);
        return { via: 'id-token', email: claims.email, cls: 2, serial: null, dn: `ID token from ${claims.iss}`, kind: 'idtoken', orgId: null, role: 'consumer', username: null };
      }
      if (session) {
        const a = q.get(db, 'SELECT username, role, cert_serial FROM accounts WHERE username=?', session.username);
        if (!a) return anonymous();
        const c = a.cert_serial ? certBySerial(a.cert_serial) : null;
        if (c && c.status !== 'valid') fail(403, `the certificate linked to this account (${c.serial}) is revoked (BIS 5.3)`);
        return { via: 'session', email: c?.email ?? null, cls: c?.cls ?? 0, serial: c?.serial ?? null, dn: c?.dn ?? a.username, kind: c?.kind ?? 'account', orgId: c?.org_id ?? null, role: a.role, username: a.username };
      }
      return anonymous();
    },
  };
}

const anonymous = () => ({ via: 'none', email: null, cls: 0, serial: null, dn: 'anonymous', kind: 'anonymous', orgId: null, role: 'anonymous', username: null });
const roleOfKind = c => (c.kind === 'rs' ? 'resource_server' : c.cls === 3 ? 'provider' : 'consumer');
export const actorOf = p => p.email || p.username || 'anonymous';

// Minimal OpenID Connect ID token check (BIS 4.4): EdDSA-signed JWT from a trusted issuer, audience = this DX, not expired.
export function trustedIssuers(cfg) {
  if (cfg._issuers) return cfg._issuers;
  const list = [];
  const p = ca.pkiPaths(cfg.pkiDir);
  if (fs.existsSync(p.idpPub)) list.push({ iss: 'https://idp.demo-city.example', key: crypto.createPublicKey(fs.readFileSync(p.idpPub)) });
  if (cfg.oidcIssuersFile && fs.existsSync(cfg.oidcIssuersFile)) {
    for (const x of JSON.parse(fs.readFileSync(cfg.oidcIssuersFile, 'utf8'))) list.push({ iss: x.iss, key: crypto.createPublicKey(x.publicKeyPem) });
  }
  cfg._issuers = list;
  return list;
}
export function verifyIdToken(jwt, cfg) {
  const parts = jwt.split('.');
  need(parts.length === 3, 401, 'ID token is not a JWT');
  let h, c;
  try { h = JSON.parse(Buffer.from(parts[0], 'base64url')); c = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { fail(401, 'ID token is not a JWT'); }
  need(h.alg === 'EdDSA', 401, 'ID token algorithm must be EdDSA');
  const iss = trustedIssuers(cfg).find(i => i.iss === c.iss);
  need(iss, 401, 'ID token issuer is not trusted by this DX');
  const ok = crypto.verify(null, Buffer.from(parts[0] + '.' + parts[1]), iss.key, Buffer.from(parts[2], 'base64url'));
  need(ok, 401, 'ID token signature is invalid');
  need(c.aud === cfg.publicName || (Array.isArray(c.aud) && c.aud.includes(cfg.publicName)), 401, 'ID token audience is not this DX');
  need(typeof c.exp === 'number' && c.exp * 1000 > Date.now(), 401, 'ID token expired');
  need(c.email && c.email_verified === true, 401, 'ID token has no verified email');
  return c;
}
export function mintIdToken(privateKeyPem, { email, aud, iss = 'https://idp.demo-city.example', ttlSec = 3600 }) {
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b({ alg: 'EdDSA', typ: 'JWT' }), body = b({ iss, aud, sub: crypto.createHash('sha256').update(email).digest('hex').slice(0, 24), email, email_verified: true, iat: now, exp: now + ttlSec });
  const sig = crypto.sign(null, Buffer.from(head + '.' + body), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
  return `${head}.${body}.${sig}`;
}
