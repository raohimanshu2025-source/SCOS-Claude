// Resource access service (BIS 4.5.2.3 resource server and DX Adapter, Table 2 Resource interface, Figure 2 steps 6-13).
// Resource servers hosted in this process: every server item whose host has a class 1 certificate here.
// A server marked legacy is not DX compliant: it only exports CSV with its own column names, and the DX Adapter
// in front of it does the token checks and the translation to the data model.
import { isJwt } from './provider-auth.js';
import { q, kv } from '../db.js';
import { iso, fail, need, sha256 } from '../util.js';
import { MODELS, modelOfRef, validatePacket } from './model.js';
import { actorOf } from '../identity/identity.js';

const MEDIA_TYPES = ['image/svg+xml', 'image/jpeg', 'image/png', 'video/mp4', 'video/webm'];
const OPS = { gt: (a, b) => a > b, ge: (a, b) => a >= b, lt: (a, b) => a < b, le: (a, b) => a <= b, eq: (a, b) => a == b }; // eslint-disable-line eqeqeq
export const timeFieldOf = model => Object.entries(MODELS[model]?.props || {}).find(([, d]) => d[0] === 'TimeProperty')?.[0];

// The legacy system's own column names (what a non-compliant SCADA export might look like).
const LEGACY_COLS = { drainLevel: { LVL_M: 'level', FLOW_CUMECS: 'flow', CAP_M: 'capacity', TS_UTC: 'observationDateTime' } };

export function makeResource(db, cfg, audit, catalogue, authz, providerAuth = null) {
  const localServers = () => {
    const out = new Map();
    for (const s of catalogue.all('resourceServer')) {
      const host = new URL(s.doc.resourceServerHTTPAccessURL.value).hostname;
      const c = q.get(db, `SELECT * FROM certs WHERE cn=? AND kind='rs' AND status='valid'`, host);
      if (c) out.set(s.id, { id: s.id, host, legacy: (s.doc.tags?.value || []).includes('adapter'), principal: { cls: 1, kind: 'rs', cn: c.cn, email: c.email, serial: c.serial } });
    }
    return out;
  };
  // server id -> false when paused (BIS 5.6 failure testing); kept in the database so every worker process agrees
  const up = { get: id => kv.get(db, 'switch:rs:' + id, true), set: (id, v) => kv.set(db, 'switch:rs:' + id, v) };

  function locate(id) {
    const it = catalogue.get(String(id || ''));
    need(it && it.item_type === 'resourceItem', 404, 'no such resource item: ' + id);
    const srv = localServers().get(it.doc.resourceServer.value);
    need(srv, 421, `this item is served by another resource server: ${catalogue.doc(it.doc.resourceServer.value)?.resourceServerHTTPAccessURL?.value}`);
    need(up.get(srv.id) !== false, 503, `${srv.host} is not available; re-initiate the request later (BIS 5.6)`, { retry: true });
    const model = modelOfRef(it.doc.refDataModel.value);
    return { it, srv, model };
  }

  // Figure 2: steps 6 and 7-13 with the trace kept for the caller.
  function authorize(p, it, srv, token, trace) {
    const S = (n, text, ok = true) => trace.push({ step: n, text, ok });
    S(6, `GET https://${srv.host}/resource/v1 id=${it.id}${token ? ' with token …' + String(token).slice(-8) : ' (no token)'}${srv.legacy ? ' via DX Adapter' : ''}`);
    if (it.policy.label === 'public') { S(6, 'public item: no token needed (BIS 4.1 transparency, 5.4.2 anonymous access)'); return null; }
    const own = it.doc.authorizationServerInfo?.value?.authType === 'provider-own' ? it.doc.authorizationServerInfo.value.authServer : null;
    if (!token && own) fail(401, `no access token; this provider runs its own authorization server: ask ${own} (BIS 4.5.2.3), or the DX at https://${cfg.authHost}/auth/v1/token`, { authServer: own, dxAuthServer: `https://${cfg.authHost}/auth/v1/token` });
    // a signed JWT on an item whose provider runs its own authorization server is checked here (BIS 4.5.2.3)
    if (own && providerAuth && isJwt(token)) return providerAuth.verify(p, it, srv, token, S);
    if (!token) {
      S(6, `no valid token: the ${srv.legacy ? 'DX Adapter' : 'resource server'} starts DX/UMA 2.0; ask https://${cfg.authHost}/auth/v1/token`, false);
      fail(401, 'no valid access token; request one from the authorization service (BIS 4.5.2.3)', { authServer: `https://${cfg.authHost}/auth/v1/token`, authorizationFlow: trace });
    }
    const r = authz.introspect(srv.principal, token, it.id);
    if (r.cached) S(7, 'token already validated by this resource server; steps 7-10 skipped (BIS 4.5.2.2)');
    else { S(7, `POST https://${cfg.authHost}/auth/v1/token/introspect by ${srv.host} (class 1)`); S(8, 'resource server identity verified'); S(9, 'token check: ' + (r.ok ? 'valid' : r.reason), r.ok); }
    if (!r.ok) { S(12, '403 Forbidden', false); audit.log('Resource', actorOf(p), 'Access refused', `${it.id}: ${r.reason}`, false); fail(403, 'invalid access token: ' + r.reason, { authorizationFlow: trace }); }
    // sender-constrained token: whoever presents it must be the consumer it was issued to
    if (r.rec.cert_serial) need(p.serial === r.rec.cert_serial, 403, 'token was issued to another certificate; present it over TLS with that certificate', { authorizationFlow: trace });
    else need(p.email === r.rec.consumer, 403, 'token was issued to another consumer', { authorizationFlow: trace });
    if (!r.cached) S(10, `200 OK from authorization service: consumer ${r.rec.consumer}, class ${r.rec.cls}`);
    authz.recordAccess(r.rec.hash);
    return r.rec;
  }

  // ---- data read paths ----
  function legacyCsv(itemId, model) {
    const map = LEGACY_COLS[model]; if (!map) return null;
    const cols = Object.keys(map);
    const rows = q.all(db, 'SELECT data FROM readings WHERE item_id=? ORDER BY ts', itemId).map(r => JSON.parse(r.data));
    return [cols.join(','), ...rows.map(d => cols.map(c => d[map[c]]).join(','))].join('\n');
  }
  function adapterRead(itemId, model) {
    const csv = legacyCsv(itemId, model); const map = LEGACY_COLS[model];
    const [head, ...lines] = csv.split('\n').filter(Boolean); const cols = head.split(',');
    return lines.map(l => { const v = l.split(','); const o = {}; cols.forEach((c, i) => { const k = map[c]; o[k] = k === 'observationDateTime' ? v[i] : Number(v[i]); }); return o; });
  }
  function rowsOf(it, model, srv) {
    const d = it.data || { kind: 'series' };
    if (d.kind === 'series') return srv?.legacy && LEGACY_COLS[model] ? adapterRead(it.id, model) : q.all(db, 'SELECT data FROM readings WHERE item_id=? ORDER BY ts', it.id).map(r => JSON.parse(r.data));
    if (d.kind === 'table') return q.all(db, 'SELECT data FROM table_rows WHERE item_id=? ORDER BY n', it.id).map(r => JSON.parse(r.data));
    const src = catalogue.get(d.src); if (!src) return [];
    const base = rowsOf(src, modelOfRef(src.doc.refDataModel.value), null);
    if (d.kind === 'view') return base.map(r => Object.fromEntries(d.attrs.map(a => [a, r[a]])));
    const m = new Map();
    for (const r of base) { const k = JSON.stringify(d.attrs.map(a => r[a])); m.set(k, (m.get(k) || 0) + 1); }
    return [...m].map(([k, n]) => ({ ...Object.fromEntries(JSON.parse(k).map((v, i) => [d.attrs[i], v])), count: n }));
  }
  const ctxOf = model => `<catalogue-link>/${model}/${model}_dataModel.json`;

  // BIS 4.5.2.1: an operation such as get data or status asked on a resource group runs on every item of the
  // group. Each item is checked on its own; items the caller may not read are listed with the reason.
  function readGroup(p, op, params, token, grp) {
    need(['latest', 'status', 'count'].includes(op), 400, 'on a resource group, use latest, status or count');
    const items = catalogue.all('resourceItem').filter(i => i.doc.resourceServerGroup?.value === grp.id);
    const results = [], refused = [];
    for (const i of items) {
      try { results.push(read(p, op, { ...params, id: i.id, trace: undefined }, token)); }
      catch (e) { refused.push({ id: i.id, status: e.status || 500, error: e.message }); }
    }
    audit.log('Resource', actorOf(p), `${op} on group`, `${grp.id}: ${results.length} item(s) answered, ${refused.length} refused`);
    return { group: grp.id, items: items.length, results, refused };
  }

  function read(p, op, params, token) {
    const grp = catalogue.get(String(params.id || ''));
    if (grp?.item_type === 'resourceServerGroup') return readGroup(p, op, params, token, grp);
    const trace = [];
    const { it, srv, model } = locate(params.id);
    const t0 = Date.now();
    const tok = authorize(p, it, srv, token, trace);
    const rows = rowsOf(it, model, srv);
    const tf = timeFieldOf(model);
    let body;
    if (op === 'latest') body = (it.data?.kind || 'series') === 'series' ? { '@context': ctxOf(model), id: it.id, ...(rows.at(-1) || {}) } : { '@context': ctxOf(model), id: it.id, results: rows.slice(0, 5), note: 'first 5 rows of a table' };
    else if (op === 'status') body = { id: it.id, server: srv.host, status: it.doc.itemStatus?.value || 'active', lastUpdate: (tf && rows.at(-1)?.[tf]) || it.modified_at };
    else if (op === 'count') body = { id: it.id, count: filterRows(rows, params, tf).length };
    else if (op === 'search') {
      const out = filterRows(rows, params, tf);
      const off = Math.max(0, Number(params.offset) || 0), lim = Math.min(1000, Math.max(1, Number(params.limit) || 100));
      body = { '@context': ctxOf(model), id: it.id, total: out.length, results: out.slice(off, off + lim) };
    } else if (op === 'download') {
      need(it.doc.resourceType.value === 'file', 400, 'download is for file resources');
      const geo = Object.entries(MODELS[model].props).find(([, dd]) => dd[0] === 'GeoProperty')?.[0];
      body = { type: 'FeatureCollection', features: rows.map(r => ({ type: 'Feature', properties: Object.fromEntries(Object.entries(r).filter(([k]) => k !== geo)), geometry: r[geo] })) };
    } else fail(404, 'unknown operation');
    trace.push({ step: 11, text: '200 OK, data returned', ok: true });
    audit.log('Resource', actorOf(p), `${op}${srv.legacy ? ' via DX Adapter' : ''}`, `${it.id}${tok ? ' token …' + tok.tail : ''} ${Date.now() - t0} ms`);
    return params.trace ? { ...body, authorizationFlow: trace } : body;
  }

  function filterRows(rows, f, tf) {
    let out = rows;
    if (f.time && tf) {
      const a = Date.parse(f.time), b = f.endtime ? Date.parse(f.endtime) : NaN, rel = f.timerel || 'after';
      need(!isNaN(a), 400, 'time must be ISO 8601');
      need(['after', 'before', 'during'].includes(rel), 400, 'timerel must be after, before or during');
      if (rel === 'during') need(!isNaN(b), 400, 'during needs endtime');
      out = out.filter(r => { const t = Date.parse(r[tf]); return rel === 'after' ? t >= a : rel === 'before' ? t <= a : t >= a && t <= b; });
    }
    if (f.attr) {
      const op = OPS[f.op || 'eq']; need(op, 400, 'op must be gt, ge, lt, le or eq');
      const v = isNaN(Number(f.value)) ? f.value : Number(f.value);
      out = out.filter(r => r[f.attr] !== undefined && op(r[f.attr], v));
    }
    if (f.bbox) {
      const b = String(f.bbox).split(',').map(Number); need(b.length === 4 && b.every(Number.isFinite), 400, 'bbox must be west,south,east,north');
      out = out.filter(r => { const g = Object.values(r).find(x => x && x.type === 'Point'); return g && g.coordinates[0] >= b[0] && g.coordinates[0] <= b[2] && g.coordinates[1] >= b[1] && g.coordinates[1] <= b[3]; });
    }
    return out;
  }

  const api = {
    localServers,
    setServerUp(id, on, by) { need(localServers().has(id), 404, 'not a local resource server'); up.set(id, !!on); audit.log('Operations', by, (on ? 'Resumed ' : 'Paused ') + id, ''); },
    serverUp: id => up.get(id) !== false,
    read,
    rowsOf: (it) => rowsOf(it, modelOfRef(it.doc.refDataModel.value), localServers().get(it.doc.resourceServer.value)),
    // Provider pushes data (BIS Table 1: provider provides the data), checked against the data model (6.4.2).
    // BIS 4.5.2.1 media resources: live and archived playback and download of media files (camera pictures here).
    mediaPut(p, { id, mime, data, ts }) {
      const it = catalogue.get(String(id || '')); need(it && it.item_type === 'resourceItem', 404, 'no such resource item');
      catalogue.assertOwner(it, p, 'add media to');
      need(it.doc.resourceType.value === 'mediaStream', 400, 'media can only be added to a mediaStream item');
      need(MEDIA_TYPES.includes(mime), 400, 'mime must be one of ' + MEDIA_TYPES.join(', '));
      const buf = Buffer.from(String(data || ''), 'base64'); need(buf.length > 0 && buf.length <= 2 << 20, 400, 'data must be base64, 1 byte to 2 MB');
      const t = iso(ts ? Date.parse(ts) : Date.now()); need(!isNaN(Date.parse(t)), 400, 'ts must be ISO 8601');
      q.run(db, 'INSERT OR REPLACE INTO media (item_id, ts, mime, bytes) VALUES (?,?,?,?)', it.id, t, mime, buf);
      q.run(db, 'DELETE FROM media WHERE item_id=? AND ts NOT IN (SELECT ts FROM media WHERE item_id=? ORDER BY ts DESC LIMIT 500)', it.id, it.id);
      return { id: it.id, ts: t, mime, bytes: buf.length };
    },
    mediaRead(p, op, params, token) {
      const { it, srv } = locate(params.id);
      need(it.doc.resourceType.value === 'mediaStream', 400, 'not a media resource');
      const tok = authorize(p, it, srv, token, []);
      let out;
      if (op === 'list') {
        const a = params.time ? Date.parse(params.time) : 0, b = params.endtime ? Date.parse(params.endtime) : Date.now() + 60e3;
        need(!isNaN(a) && !isNaN(b), 400, 'time and endtime must be ISO 8601');
        const rows = q.all(db, 'SELECT ts, mime, length(bytes) bytes FROM media WHERE item_id=? AND ts>=? AND ts<=? ORDER BY ts', it.id, iso(a), iso(b));
        out = { id: it.id, total: rows.length, files: rows.map(r => ({ ts: r.ts, mime: r.mime, bytes: r.bytes })) };
      } else {
        const r = op === 'file' ? q.get(db, 'SELECT * FROM media WHERE item_id=? AND ts=?', it.id, iso(Date.parse(params.ts))) : q.get(db, 'SELECT * FROM media WHERE item_id=? ORDER BY ts DESC LIMIT 1', it.id);
        need(r, 404, 'no media file' + (op === 'file' ? ' at that time' : ' yet'));
        out = { ts: r.ts, mime: r.mime, bytes: Buffer.from(r.bytes) };
      }
      if (op !== 'live') audit.log('Resource', actorOf(p), 'media ' + op, `${it.id}${tok ? ' token …' + tok.tail : ''}`);
      return out;
    },

    ingest(p, { id, data, mode }) {
      const it = catalogue.get(String(id || '')); need(it && it.item_type === 'resourceItem', 404, 'no such resource item');
      catalogue.assertOwner(it, p, 'ingest');
      const model = modelOfRef(it.doc.refDataModel.value);
      need(Array.isArray(data) && data.length && data.length <= 5000, 400, 'data must be a list of 1-5000 packets');
      const errs = data.flatMap((pk, i) => validatePacket(model, pk).map(e => `packet ${i}: ${e}`));
      if (errs.length) { audit.log('Resource', actorOf(p), 'Ingest refused', `${id}: ${errs[0]}`, false); fail(400, 'data does not match the data model', { errors: errs.slice(0, 20) }); }
      const kind = it.data?.kind || 'series';
      need(kind === 'series' || kind === 'table', 400, 'views are computed; push data to their source item');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (kind === 'series') {
          const tf = timeFieldOf(model); need(tf, 400, 'data model has no time attribute');
          const ins = db.prepare('INSERT OR REPLACE INTO readings (item_id, ts, data) VALUES (?,?,?)');
          for (const pk of data) { need(pk[tf], 400, `every packet needs ${tf}`); ins.run(it.id, new Date(pk[tf]).toISOString(), JSON.stringify(pk)); }
        } else {
          if (mode !== 'append') q.run(db, 'DELETE FROM table_rows WHERE item_id=?', it.id);
          const start = (q.get(db, 'SELECT MAX(n) m FROM table_rows WHERE item_id=?', it.id)?.m ?? -1) + 1;
          const ins = db.prepare('INSERT INTO table_rows (item_id, n, data) VALUES (?,?,?)');
          data.forEach((pk, i) => ins.run(it.id, start + i, JSON.stringify(pk)));
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      audit.log('Resource', actorOf(p), 'Data ingested', `${id}: ${data.length} packet(s)`);
      return { id, accepted: data.length };
    },
    // Subscriptions (Table 2: Subscribe, Update Subscription, Unsubscribe). Delivery is by server-sent events.
    subscribe(p, { id, every }, token) {
      const { it, srv } = locate(id); authorize(p, it, srv, token, []);
      need(p.email || it.policy.label === 'public', 401, 'identity required to subscribe');
      const sid = 'SUB-' + sha256(Math.random() + id + Date.now()).slice(0, 12).toUpperCase();
      q.run(db, 'INSERT INTO subscriptions (id, consumer, item_id, every_sec, created_at) VALUES (?,?,?,?,?)', sid, p.email || 'anonymous', it.id, clampEvery(every), iso(Date.now()));
      audit.log('Resource', actorOf(p), 'Subscribed', `${sid} ${it.id}`);
      return { subscriptionId: sid, stream: `/resource/v1/subscription/stream?sid=${sid}`, everySec: clampEvery(every) };
    },
    getSub(sid, p) { const s = q.get(db, 'SELECT * FROM subscriptions WHERE id=? AND active=1', sid); need(s && s.consumer === (p.email || 'anonymous'), 404, 'no such subscription'); return s; },
    updateSub(p, { sid, every }) { const s = api.getSub(sid, p); q.run(db, 'UPDATE subscriptions SET every_sec=? WHERE id=?', clampEvery(every), s.id); audit.log('Resource', actorOf(p), 'Subscription updated', `${sid} every ${clampEvery(every)} s`); return { ...s, every_sec: clampEvery(every) }; },
    unsubscribe(p, sid) { const s = api.getSub(sid, p); q.run(db, 'UPDATE subscriptions SET active=0 WHERE id=?', s.id); audit.log('Resource', actorOf(p), 'Unsubscribed', sid); },
    // For the stream: new packets after `since`, re-checking the token each time.
    poll(p, sub, token, since) {
      const { it, srv, model } = locate(sub.item_id);
      authorize(p, it, srv, token, []);
      const tf = timeFieldOf(model);
      return rowsOf(it, model, srv).filter(r => !since || (tf && Date.parse(r[tf]) > since));
    },
    // For MQTT (BIS 6.5): the same access check as a read, without reading.
    canRead(p, id, token) { const { it, srv } = locate(id); authorize(p, it, srv, token, []); return it; },
    legacyCsv,
  };
  return api;
}
const clampEvery = e => Math.min(3600, Math.max(1, Number(e) || 5));
