// Central access control rules set at state or national level (City OS Section 1: "centralised access control
// policies may be set at national level"). A state or national node publishes the rules; each city node that names
// it in DX_CENTRAL_POLICY_URL pulls them every hour and applies them on top of its providers' own policies.
// The rules can only narrow access, never widen it:
//   blockedConsumers  e-mail addresses that may not get tokens for non-public data anywhere in the state
//   labelClasses      for a label, the certificate classes still allowed (intersected with the city's own rule)
//   maxTokenTtlSec    the longest token life any city may issue
import https from 'node:https';
import fs from 'node:fs';
import { q } from '../db.js';
import { iso, need, str } from '../util.js';
import { actorOf } from '../identity/identity.js';

const LABELS = ['protected', 'private', 'confidential'];

function clean(b = {}) {
  const r = {};
  if (b.blockedConsumers !== undefined) {
    need(Array.isArray(b.blockedConsumers) && b.blockedConsumers.length <= 500, 400, 'blockedConsumers must be a list of e-mail addresses');
    r.blockedConsumers = b.blockedConsumers.map(e => str(e, 200).toLowerCase()).filter(e => e.includes('@'));
  }
  if (b.labelClasses !== undefined) {
    need(b.labelClasses && typeof b.labelClasses === 'object', 400, 'labelClasses must map a label to a list of classes');
    r.labelClasses = {};
    for (const [l, cls] of Object.entries(b.labelClasses)) {
      need(LABELS.includes(l), 400, `labelClasses: label must be one of ${LABELS.join(', ')}`);
      need(Array.isArray(cls) && cls.every(c => Number.isInteger(c) && c >= 1 && c <= 5), 400, 'labelClasses: classes are whole numbers 1 to 5');
      r.labelClasses[l] = cls;
    }
  }
  if (b.maxTokenTtlSec !== undefined) { need(Number.isInteger(b.maxTokenTtlSec) && b.maxTokenTtlSec >= 60 && b.maxTokenTtlSec <= 86400, 400, 'maxTokenTtlSec must be 60 to 86400'); r.maxTokenTtlSec = b.maxTokenTtlSec; }
  r.note = str(b.note, 300) || null;
  return r;
}

export function makeCentralPolicy({ db, cfg, audit }) {
  const read = k => { const r = q.get(db, 'SELECT v FROM kv WHERE k=?', k); return r ? JSON.parse(r.v) : null; };
  const write = (k, v) => q.run(db, 'INSERT OR REPLACE INTO kv (k, v) VALUES (?,?)', k, JSON.stringify(v));
  let timer = null;

  const api = {
    // The rules this node applies: pulled from the state or national node, else none.
    effective: () => (cfg.centralPolicyUrl ? read('central-policy-pulled') : null),
    // What this node publishes to the nodes below it (state or national tier).
    published: () => read('central-policy-published'),
    publish(p, body) {
      need(['admin'].includes(p.role), p.role === 'anonymous' ? 401 : 403, 'only the administrator of a state or national node can set central rules');
      need(cfg.tier === 'state' || cfg.tier === 'national', 409, 'central rules are set on a state or national node (DX_TIER)');
      const rules = { ...clean(body), issuer: cfg.regionName, tier: cfg.tier, version: (api.published()?.version || 0) + 1, setAt: iso(Date.now()), setBy: actorOf(p) };
      write('central-policy-published', rules);
      audit.log('Authorization', actorOf(p), 'Central access rules published', `version ${rules.version}: ${JSON.stringify({ blockedConsumers: rules.blockedConsumers?.length || 0, labelClasses: rules.labelClasses || {}, maxTokenTtlSec: rules.maxTokenTtlSec || null })}`);
      return rules;
    },
    async pull() {
      if (!cfg.centralPolicyUrl) return null;
      const ca = cfg.federationCaFile && fs.existsSync(cfg.federationCaFile) ? fs.readFileSync(cfg.federationCaFile) : undefined;
      try {
        const got = await new Promise((resolve, reject) => {
          const r = https.get(new URL('/ops/v1/central-policy', cfg.centralPolicyUrl), { ca, timeout: 8000 }, res => {
            let d = ''; res.on('data', c => (d += c));
            res.on('end', () => { try { const j = JSON.parse(d); res.statusCode === 200 ? resolve(j.published) : reject(new Error(j.error || 'HTTP ' + res.statusCode)); } catch { reject(new Error('not JSON')); } });
          });
          r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', reject);
        });
        if (!got) return api.effective();
        const rules = { ...clean(got), issuer: str(got.issuer, 120), tier: str(got.tier, 20), version: Number(got.version) || 0, setAt: str(got.setAt, 40), pulledAt: iso(Date.now()) };
        const old = api.effective();
        write('central-policy-pulled', rules);
        if (!old || old.version !== rules.version || old.issuer !== rules.issuer) audit.log('Authorization', 'Data Exchange', 'Central access rules applied', `version ${rules.version} from ${rules.issuer || cfg.centralPolicyUrl}`);
        return rules;
      } catch (e) {
        // keep the last rules we had: a state node being down must not open access
        audit.log('Authorization', 'Data Exchange', 'Central access rules not refreshed', `${cfg.centralPolicyUrl}: ${e.message}`, false);
        return api.effective();
      }
    },
    // Called by the authorization service for non-public items. Returns a refusal message or null.
    check(p, it) {
      const r = api.effective(); if (!r) return null;
      if (r.blockedConsumers?.includes(String(p.email).toLowerCase())) return `blocked by the central access rules of ${r.issuer || 'the state'} (version ${r.version})`;
      const allowed = r.labelClasses?.[it.policy.label];
      if (allowed && !allowed.includes(p.cls)) return `the central access rules of ${r.issuer || 'the state'} allow only class ${allowed.join(' or ')} certificates for ${it.policy.label} data`;
      return null;
    },
    maxTtl: () => api.effective()?.maxTokenTtlSec || Infinity,
    start() { if (cfg.centralPolicyUrl && !timer) { api.pull(); timer = setInterval(() => api.pull(), 3600e3); timer.unref(); } },
    stop() { clearInterval(timer); timer = null; },
  };
  return api;
}
