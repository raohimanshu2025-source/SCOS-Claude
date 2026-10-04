// DX Certificate Authority (BIS 5.4.2) built on the OpenSSL command line tool.
// Root CA -> DX CA (intermediate) -> holder certificates in five classes, with a revocation list (BIS 5.3).
// The OIDs below sit under a UUID-based arc (ITU-T X.667, 2.25) and mark the DX class; they are demo identifiers,
// not OIDs assigned by BIS or CCA.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const CLASS_OID_ARC = '2.25.228127155926915386208736734112418384017';
export const CLASS_TEXT = {
  0: 'Organisation certificate: only grants certificates to its employees (not one of the five classes)',
  1: 'Resource servers, to validate tokens',
  2: 'Individuals or employees: protected data',
  3: 'Employees and data officers: create and manage catalogue items',
  4: 'Trusted employees: protected and private data',
  5: 'Trusted employees: protected, private and confidential data',
};

function ossl(args, input) {
  try {
    return execFileSync('openssl', args, { input, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    const msg = String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ');
    throw new Error('openssl ' + args[0] + ' failed: ' + msg);
  }
}

const tmpFile = (content, ext = '.pem') => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dxca-')), 'f' + ext);
  fs.writeFileSync(f, content, { mode: 0o600 });
  return f;
};
const rmTmp = f => fs.rmSync(path.dirname(f), { recursive: true, force: true });

function caConfig(dir, crlUrl) {
  const cls = n => `[ class${n} ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature${n === 1 ? ',keyEncipherment' : ''}
extendedKeyUsage = clientAuth${n === 1 ? ',serverAuth' : ',emailProtection'}
certificatePolicies = ${CLASS_OID_ARC}.${n}
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
crlDistributionPoints = URI:${crlUrl}
`;
  return `[ ca ]
default_ca = dxca
[ dxca ]
dir = ${dir}
database = $dir/index.txt
serial = $dir/serial
crlnumber = $dir/crlnumber
new_certs_dir = $dir/certs
certificate = $dir/dxca.crt
private_key = $dir/dxca.key
default_md = sha256
default_days = 365
default_crl_days = 7
policy = pol
unique_subject = no
copy_extensions = none
email_in_dn = yes
preserve = yes
[ pol ]
commonName = supplied
emailAddress = supplied
organizationName = optional
organizationalUnitName = optional
givenName = optional
surname = optional
title = optional
stateOrProvinceName = optional
localityName = optional
${[1, 2, 3, 4, 5].map(cls).join('')}[ org ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = clientAuth,emailProtection
certificatePolicies = ${CLASS_OID_ARC}.0
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
crlDistributionPoints = URI:${crlUrl}
`;
}

export function pkiPaths(pkiDir) {
  const d = path.resolve(pkiDir);
  return {
    dir: d,
    rootKey: path.join(d, 'root', 'root.key'), rootCrt: path.join(d, 'root', 'root.crt'),
    caDir: path.join(d, 'dxca'), caKey: path.join(d, 'dxca', 'dxca.key'), caCrt: path.join(d, 'dxca', 'dxca.crt'),
    caCnf: path.join(d, 'dxca', 'openssl.cnf'), crl: path.join(d, 'dxca', 'crl.pem'),
    serverKey: path.join(d, 'server', 'server.key'), serverCrt: path.join(d, 'server', 'server.crt'),
    auditKey: path.join(d, 'audit', 'audit-ed25519.key'), consentKey: path.join(d, 'audit', 'consent-ed25519.key'),
    idpKey: path.join(d, 'idp', 'idp-ed25519.key'), idpPub: path.join(d, 'idp', 'idp-ed25519.pub'),
    clients: path.join(d, 'clients'),
  };
}

// Creates the whole PKI once. Safe to call again: existing material is kept.
export function initPki(pkiDir, { publicName = 'dx.demo-city.example', crlUrl, altNames = [] } = {}) {
  const p = pkiPaths(pkiDir);
  for (const sub of ['root', 'dxca/certs', 'server', 'audit', 'idp', 'clients']) fs.mkdirSync(path.join(p.dir, sub), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(p.rootCrt)) {
    ossl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', p.rootKey, '-out', p.rootCrt,
      '-days', '3650', '-subj', '/CN=Demo City DX Root CA (demo)/O=Demo City (demo)',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  }
  if (!fs.existsSync(p.caCrt)) {
    const csr = ossl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', p.caKey,
      '-subj', '/CN=DX Certificate Authority (demo)/O=Demo City (demo)']);
    const ext = tmpFile('basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n', '.cnf');
    try {
      ossl(['x509', '-req', '-CA', p.rootCrt, '-CAkey', p.rootKey, '-CAcreateserial', '-days', '1825', '-sha256', '-extfile', ext, '-out', p.caCrt], csr);
    } finally { rmTmp(ext); }
    fs.writeFileSync(path.join(p.caDir, 'index.txt'), '');
    fs.writeFileSync(path.join(p.caDir, 'index.txt.attr'), 'unique_subject = no\n');
    fs.writeFileSync(path.join(p.caDir, 'serial'), '1' + crypto.randomBytes(8).toString('hex').toUpperCase().slice(1) + '\n');
    fs.writeFileSync(path.join(p.caDir, 'crlnumber'), '1000\n');
  }
  fs.writeFileSync(p.caCnf, caConfig(p.caDir, crlUrl || `https://${publicName}/identity/v1/crl.pem`));
  if (!fs.existsSync(p.crl)) genCrl(p);
  if (!fs.existsSync(p.serverCrt)) {
    const names = [...new Set([publicName, 'localhost', ...altNames])];
    const san = names.map((n, i) => `DNS.${i + 1} = ${n}`).join('\n') + '\nIP.1 = 127.0.0.1\nIP.2 = ::1\n';
    const csr = ossl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', p.serverKey,
      '-subj', `/CN=${publicName}/O=Demo City (demo)`]);
    const ext = tmpFile(`[s]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=@alt\n[alt]\n${san}`, '.cnf');
    try {
      ossl(['x509', '-req', '-CA', p.caCrt, '-CAkey', p.caKey, '-CAcreateserial', '-days', '397', '-sha256', '-extfile', ext, '-extensions', 's', '-out', p.serverCrt], csr);
    } finally { rmTmp(ext); }
  }
  for (const [file, pub] of [[p.auditKey, null], [p.consentKey, null], [p.idpKey, p.idpPub]]) {
    if (fs.existsSync(file)) continue;
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    if (pub) fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
  }
  return p;
}

function genCrl(p) { ossl(['ca', '-config', p.caCnf, '-gencrl', '-out', p.crl, '-batch']); }

// Reads a PEM certificate request and checks its self-signature.
export function readCsr(csrPem) {
  if (!/-----BEGIN CERTIFICATE REQUEST-----/.test(csrPem || '')) throw new Error('not a PEM certificate signing request');
  const f = tmpFile(csrPem);
  try {
    const out = ossl(['req', '-in', f, '-noout', '-verify', '-subject', '-nameopt', 'sep_multiline,lname,utf8']);
    const subj = {};
    for (const line of out.split('\n')) { const m = line.match(/^\s+(\w+)=(.*)$/); if (m) subj[m[1]] = m[2].trim(); }
    return { cn: subj.commonName || '', email: (subj.emailAddress || '').toLowerCase(), org: subj.organizationName || '', ou: subj.organizationalUnitName || '' };
  } finally { rmTmp(f); }
}

// Signs a CSR with the DX CA as the given class. Returns the PEM and the parsed certificate facts.
export function signCsr(pkiDir, csrPem, cls, days = 365) {
  if (![0, 1, 2, 3, 4, 5].includes(cls)) throw new Error('class must be 1 to 5, or 0 for an organisation certificate');
  const p = pkiPaths(pkiDir);
  const f = tmpFile(csrPem), out = path.join(path.dirname(f), 'out.pem');
  try {
    ossl(['ca', '-config', p.caCnf, '-batch', '-notext', '-extensions', cls === 0 ? 'org' : 'class' + cls, '-days', String(days), '-in', f, '-out', out]);
    return describeCert(fs.readFileSync(out, 'utf8'));
  } finally { rmTmp(f); }
}

// Makes a key pair and certificate in one go (used by the seed script and tests for demo holders).
export function issueKeyAndCert(pkiDir, { cn, email, org, cls }) {
  const p = pkiPaths(pkiDir);
  const keyFile = tmpFile('', '.key');
  try {
    const subj = `/CN=${cn.replace(/[\/=]/g, ' ')}${org ? '/O=' + org.replace(/[\/=]/g, ' ') : ''}/emailAddress=${email}`;
    const csr = ossl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', keyFile, '-subj', subj]);
    const cert = signCsr(p.dir, csr, cls);
    return { ...cert, keyPem: fs.readFileSync(keyFile, 'utf8'), csrPem: csr };
  } finally { rmTmp(keyFile); }
}

export function describeCert(pem) {
  const x = new crypto.X509Certificate(pem);
  const get = (k) => (x.subject.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '';
  return {
    pem: x.toString(), serial: x.serialNumber.toUpperCase(), fingerprint: x.fingerprint256,
    cn: get('CN'), email: (get('emailAddress') || '').toLowerCase(), org: get('O'),
    dn: x.subject.split('\n').join(', '), issuer: x.issuer.split('\n').join(', '),
    notBefore: new Date(x.validFrom).toISOString(), notAfter: new Date(x.validTo).toISOString(),
  };
}

export function revokeCert(pkiDir, serial, reason = 'unspecified') {
  const p = pkiPaths(pkiDir);
  const file = path.join(p.caDir, 'certs', serial.toUpperCase() + '.pem');
  if (!fs.existsSync(file)) throw new Error('certificate ' + serial + ' was not issued by this DX CA');
  const ok = ['unspecified', 'keyCompromise', 'affiliationChanged', 'superseded', 'cessationOfOperation'];
  ossl(['ca', '-config', p.caCnf, '-revoke', file, '-crl_reason', ok.includes(reason) ? reason : 'unspecified', '-batch']);
  genCrl(p);
}

export function crlInfo(pkiDir) {
  const p = pkiPaths(pkiDir);
  const txt = ossl(['crl', '-in', p.crl, '-noout', '-text']);
  const serials = [...txt.matchAll(/Serial Number: ([0-9A-F]+)/gi)].map(m => m[1].toUpperCase());
  const next = (txt.match(/Next Update: (.*)/) || [])[1];
  const last = (txt.match(/Last Update: (.*)/) || [])[1];
  return { pem: fs.readFileSync(p.crl, 'utf8'), revokedSerials: serials, lastUpdate: last, nextUpdate: next };
}

// Verifies a certificate chains to our root through the DX CA (used when registering holders).
export function verifyChain(pkiDir, certPem) {
  const p = pkiPaths(pkiDir);
  const f = tmpFile(certPem);
  try { ossl(['verify', '-CAfile', p.rootCrt, '-untrusted', p.caCrt, f]); return true; } catch { return false; } finally { rmTmp(f); }
}
