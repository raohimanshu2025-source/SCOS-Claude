// CIL source layer beyond the data exchange (City OS Section 4, Figure 11: "files/object stores, data warehouse").
// A source is a CSV or JSON file in the CIL source folder, an object fetched over HTTP(S) from an allowed object
// store host (for example an S3-compatible bucket), or a data exchange item copied under a DX token. Loading a
// source copies its rows into the CIL data warehouse (a fact table in the database), where OLAP pivots any
// numeric column over any two columns. Restricted sources are for the control room, administrators and analysts.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { q, tx } from '../db.js';
import { iso, round, need, fail, str } from '../util.js';
import { actorOf } from '../identity/identity.js';

const KINDS = ['file', 'object', 'dx'];
const LABELS = ['public', 'restricted'];
const READERS = ['operator', 'admin', 'analytics_provider', 'auditor'];
const MAX_BYTES = 5 * 1024 * 1024, MAX_ROWS = 50000;

// RFC 4180 CSV: quoted fields, doubled quotes, commas and new lines inside quotes. Numbers become numbers.
export function parseCsv(text) {
  const out = []; let row = [], f = '', inQ = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else inQ = false; } else f += ch; continue; }
    if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(x => x !== '')) out.push(row); row = []; }
    else f += ch;
  }
  row.push(f); if (row.some(x => x !== '')) out.push(row);
  need(out.length >= 1, 400, 'the CSV has no header row');
  const [head, ...lines] = out;
  const val = v => (v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v);
  return lines.map(l => Object.fromEntries(head.map((h, i) => [h.trim(), val(l[i] ?? '')])));
}
function parse(text, format) {
  if (format === 'csv') return parseCsv(text);
  let j; try { j = JSON.parse(text); } catch { fail(400, 'the source is not valid JSON'); }
  const rows = Array.isArray(j) ? j : Array.isArray(j?.results) ? j.results : Array.isArray(j?.rows) ? j.rows : null;
  need(rows && rows.every(r => r && typeof r === 'object' && !Array.isArray(r)), 400, 'JSON sources must be a list of objects (or {results: [...]})');
  return rows;
}
const formatOf = (name, given) => {
  const f = String(given || path.extname(name).slice(1) || '').toLowerCase();
  need(['csv', 'json'].includes(f), 400, 'format must be csv or json'); return f;
};

function fetchObject(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? https : http).get(u, { timeout: 10000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(Object.assign(new Error(`object store answered HTTP ${res.statusCode}`), { status: 502 })); }
      let n = 0; const parts = [];
      res.on('data', c => { n += c.length; if (n > MAX_BYTES) { req.destroy(); reject(Object.assign(new Error('object larger than 5 MB'), { status: 413 })); } else parts.push(c); });
      res.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('object store timeout')));
    req.on('error', e => reject(Object.assign(e, { status: e.status || 502 })));
  });
}

export function makeSources({ db, cfg, audit, catalogue, authz, resource }) {
  const dir = path.resolve(cfg.cilSourceDir || path.join(cfg.dataDir, 'cil-sources'));
  fs.mkdirSync(dir, { recursive: true });
  const row = id => { const r = q.get(db, 'SELECT * FROM cil_sources WHERE id=?', id); need(r, 404, 'no such CIL source: ' + id); return { ...r, config: JSON.parse(r.config) }; };
  const pub = r => ({ id: r.id, name: r.name, kind: r.kind, label: r.label, config: r.config, rows: r.rows, columns: r.columns ? JSON.parse(r.columns) : [], lastLoad: r.last_load, createdBy: r.created_by });
  const canRead = (p, r) => r.label === 'public' || READERS.includes(p.role);
  // DX items stay under DX rules: whoever reads their copy in the warehouse needs a DX token for the item.
  const dxCheck = (p, r, purpose) => {
    if (r.kind !== 'dx') return;
    const it = catalogue.get(r.config.item);
    if (it && it.policy.label !== 'public') { need(p.email, 401, 'this source copies protected data exchange data; identify yourself with a certificate or ID token'); authz.requestToken(p, [{ id: it.id }], purpose); }
  };

  async function read(r, p) {
    const c = r.config;
    if (r.kind === 'file') {
      const f = path.resolve(dir, c.path); need(f.startsWith(dir + path.sep), 400, 'the file must be inside the CIL source folder');
      need(fs.existsSync(f), 404, `file ${c.path} not found in the CIL source folder`);
      need(fs.statSync(f).size <= MAX_BYTES, 413, 'file larger than 5 MB');
      return parse(fs.readFileSync(f, 'utf8'), c.format);
    }
    if (r.kind === 'object') {
      try { return parse(await fetchObject(c.url), c.format); } catch (e) { if (e.status && e.status < 500 && e.status !== 413) throw e; fail(e.status || 502, 'could not fetch the object: ' + e.message); }
    }
    const it = catalogue.get(c.item); need(it && it.item_type === 'resourceItem', 404, 'no such resource item: ' + c.item);
    dxCheck(p, r, 'CIL warehouse load');
    return resource.rowsOf(it).map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : v])));
  }

  const api = {
    dir,
    list: p => q.all(db, 'SELECT * FROM cil_sources ORDER BY id').map(r => ({ ...r, config: JSON.parse(r.config) })).filter(r => canRead(p, r)).map(pub),
    // POST /cil/v1/sources {id, name, kind: file|object|dx, path | url | item, format, label}
    register(p, b) {
      const id = str(b.id, 60); need(/^[a-z0-9][a-z0-9-]{1,59}$/.test(id), 400, 'id: lower-case letters, digits and dashes');
      need(!q.get(db, 'SELECT id FROM cil_sources WHERE id=?', id), 409, 'a source with this id exists');
      const kind = String(b.kind); need(KINDS.includes(kind), 400, 'kind must be file, object or dx');
      const label = String(b.label || 'restricted'); need(LABELS.includes(label), 400, 'label must be public or restricted');
      let config;
      if (kind === 'file') {
        const rel = str(b.path, 200); need(rel, 400, 'path required');
        need(path.resolve(dir, rel).startsWith(dir + path.sep), 400, 'the file must be inside the CIL source folder');
        config = { path: rel, format: formatOf(rel, b.format) };
      } else if (kind === 'object') {
        let u; try { u = new URL(str(b.url, 500)); } catch { fail(400, 'url must be an http(s) URL'); }
        need(['http:', 'https:'].includes(u.protocol), 400, 'url must be an http(s) URL');
        need((cfg.cilObjectHosts || []).includes(u.host), 403, `object store host ${u.host} is not allowed; the administrator lists allowed hosts in DX_CIL_OBJECT_HOSTS`);
        config = { url: u.href, format: formatOf(u.pathname, b.format) };
      } else {
        const it = catalogue.get(str(b.item, 200)); need(it && it.item_type === 'resourceItem', 404, 'no such resource item: ' + b.item);
        config = { item: it.id };
      }
      q.run(db, 'INSERT INTO cil_sources (id, name, kind, label, config, rows, created_by, created_at) VALUES (?,?,?,?,?,0,?,?)', id, str(b.name, 120) || id, kind, label, JSON.stringify(config), actorOf(p), iso(Date.now()));
      audit.log('CIL', actorOf(p), 'CIL source registered', `${id} (${kind}, ${label})`);
      return pub(row(id));
    },
    // POST /cil/v1/sources/load {id}: copies the source's rows into the warehouse, replacing the previous load.
    async load(p, id) {
      const r = row(String(id));
      const rows = await read(r, p);
      need(rows.length <= MAX_ROWS, 413, `more than ${MAX_ROWS} rows`);
      const cols = [...new Set(rows.flatMap(x => Object.keys(x)))];
      const at = iso(Date.now());
      tx(db, () => {
        q.run(db, 'DELETE FROM cil_warehouse WHERE source_id=?', r.id);
        rows.forEach((x, n) => q.run(db, 'INSERT INTO cil_warehouse (source_id, n, data) VALUES (?,?,?)', r.id, n, JSON.stringify(x)));
        q.run(db, 'UPDATE cil_sources SET rows=?, columns=?, last_load=? WHERE id=?', rows.length, JSON.stringify(cols), at, r.id);
      });
      audit.log('CIL', actorOf(p), 'CIL source loaded into warehouse', `${r.id}: ${rows.length} rows`);
      return pub(row(r.id));
    },
    remove(p, id) {
      const r = row(String(id));
      tx(db, () => { q.run(db, 'DELETE FROM cil_warehouse WHERE source_id=?', r.id); q.run(db, 'DELETE FROM cil_sources WHERE id=?', r.id); });
      audit.log('CIL', actorOf(p), 'CIL source removed', r.id);
      return { ok: true };
    },
    // GET /cil/v1/warehouse?source=&limit=
    rows(p, id, limit = 100) {
      const r = row(String(id)); need(canRead(p, r), p.role === 'anonymous' ? 401 : 403, 'this source is restricted to the control room, administrators and analysts');
      dxCheck(p, r, 'CIL warehouse read');
      const lim = Math.min(1000, Math.max(1, Number(limit) || 100));
      return { source: r.id, total: r.rows, rows: q.all(db, 'SELECT data FROM cil_warehouse WHERE source_id=? ORDER BY n LIMIT ?', r.id, lim).map(x => JSON.parse(x.data)) };
    },
    // OLAP over the warehouse: sum (or count) of a measure column by two dimension columns.
    olap(p, { source, measure = 'count', rows: rd, cols: cd, agg = 'sum' }) {
      const r = row(String(source)); need(canRead(p, r), p.role === 'anonymous' ? 401 : 403, 'this source is restricted to the control room, administrators and analysts');
      need(r.last_load, 409, 'load the source into the warehouse first');
      const cols = JSON.parse(r.columns);
      need(cols.includes(rd) && cols.includes(cd) && rd !== cd, 400, `rows and cols must be two different columns of ${r.id}: ${cols.join(', ')}`);
      need(measure === 'count' || cols.includes(measure), 400, `measure must be count or a column of ${r.id}`);
      need(['sum', 'avg', 'min', 'max'].includes(agg), 400, 'agg must be sum, avg, min or max');
      dxCheck(p, r, 'CIL warehouse OLAP');
      const facts = q.all(db, 'SELECT data FROM cil_warehouse WHERE source_id=?', r.id).map(x => JSON.parse(x.data));
      const R = [...new Set(facts.map(f => String(f[rd])))].sort(), C = [...new Set(facts.map(f => String(f[cd])))].sort();
      const cell = (a, b) => {
        const v = facts.filter(f => String(f[rd]) === a && String(f[cd]) === b).map(f => (measure === 'count' ? 1 : Number(f[measure]))).filter(Number.isFinite);
        if (!v.length) return 0;
        return round(agg === 'avg' ? v.reduce((x, y) => x + y, 0) / v.length : agg === 'min' ? Math.min(...v) : agg === 'max' ? Math.max(...v) : v.reduce((x, y) => x + y, 0));
      };
      audit.log('CIL', actorOf(p), 'OLAP query', `warehouse ${r.id}: ${agg} of ${measure} by ${rd} x ${cd}`);
      return { source: r.id, measure, agg, rows: R, cols: C, cells: R.map(a => C.map(b => cell(a, b))) };
    },
  };
  return api;
}
