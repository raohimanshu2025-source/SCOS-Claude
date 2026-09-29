// Catalogue service (BIS 4.5.1, 6): JSON-LD items, Manage and Discover interfaces.
import { q, tx } from '../db.js';
import { iso, fail, need, str } from '../util.js';
import { validateItem, T4_TO_T3, LABELS, CTX } from './model.js';
import { actorOf } from '../identity/identity.js';

const DATA_KINDS = ['series', 'table', 'view', 'count'];

export function makeCatalogue(db, audit, notify) {
  const row = id => q.get(db, 'SELECT * FROM items WHERE id=? AND deleted=0', id);
  const exists = id => !!row(id);
  const parse = r => r && { ...r, doc: JSON.parse(r.doc), policy: r.policy ? JSON.parse(r.policy) : null, data: r.data_kind ? JSON.parse(r.data_kind) : null };

  function assertManager(p, what) {
    need(p.cls === 3 && p.email, 403, `${what}: a valid class 3 certificate (data officer) is needed to manage catalogue items (BIS 5.3, 5.4.2)`);
  }
  function assertOwner(r, p, what) {
    assertManager(p, what);
    need(r.owner_org && r.owner_org === p.orgId, 403, `${what}: the item belongs to another organisation; entries are linked to the certificate that created them (BIS 5.3)`);
  }
  function checkData(doc, data) {
    if (doc.itemType?.value !== 'resourceItem') return null;
    const rt = doc.resourceType?.value;
    const d = data || { kind: ['table', 'file'].includes(rt) ? 'table' : 'series' };
    need(DATA_KINDS.includes(d.kind), 400, 'data.kind must be ' + DATA_KINDS.join(', '));
    if (d.kind === 'view' || d.kind === 'count') {
      const src = row(d.src); need(src && src.item_type === 'resourceItem', 400, 'a view needs data.src pointing to a resource item');
      need(Array.isArray(d.attrs) && d.attrs.length && d.attrs.every(a => typeof a === 'string'), 400, 'a view needs data.attrs, the attributes it keeps (BIS 5.4: providers define views)');
    }
    return d;
  }

  const api = {
    get: id => parse(row(id)),
    doc: id => { const r = row(id); return r ? JSON.parse(r.doc) : null; },
    all: type => q.all(db, `SELECT * FROM items WHERE deleted=0 ${type ? 'AND item_type=?' : ''} ORDER BY id`, ...(type ? [type] : [])).map(parse),
    exists,
    assertOwner,

    create(doc, p, data) {
      assertManager(p, 'create');
      need(doc && typeof doc === 'object', 400, 'item document required');
      need(!q.get(db, 'SELECT 1 FROM items WHERE id=?', doc.id), 409, 'an item with this id already exists');
      const now = iso(Date.now());
      doc = { ...doc, createdAt: { type: 'TimeProperty', value: now }, itemStatus: doc.itemStatus || { type: 'Property', value: 'active' } };
      const errs = validateItem(doc, exists);
      if (errs.length) { audit.log('Manage', actorOf(p), 'Item refused', `${doc.id}: ${errs[0]}`, false); fail(400, 'item does not meet the catalogue model', { errors: errs }); }
      for (const ref of ['provider', 'resourceServerGroup']) {
        const target = doc[ref] && row(doc[ref].value);
        if (target) need(target.owner_org === p.orgId, 403, `${ref} ${doc[ref].value} belongs to another organisation`);
      }
      const d = checkData(doc, data);
      const label = doc.accessPolicyLabel?.value ?? null;
      const policy = label ? { label, C: [], A: { ...T4_TO_T3[label] }, version: 1 } : null;
      q.run(db, 'INSERT INTO items (id, item_type, owner_dn, owner_org, doc, label, policy, data_kind, created_at, modified_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        doc.id, doc.itemType.value, p.dn, p.orgId, JSON.stringify(doc), label, policy && JSON.stringify(policy), d && JSON.stringify(d), now, now);
      audit.log('Manage', actorOf(p), 'Item created', `${doc.id} (${doc.itemType.value}${label ? ', ' + label : ''})`);
      return api.get(doc.id);
    },
    update(id, doc, p) {
      const r = row(id); need(r, 404, 'no such item'); assertOwner(r, p, 'update');
      need(doc && doc.id === id, 400, 'the document id must match the item id');
      need(doc.itemType?.value === r.item_type, 400, 'itemType cannot change');
      const old = JSON.parse(r.doc);
      doc = { ...doc, createdAt: old.createdAt, modifiedAt: { type: 'TimeProperty', value: iso(Date.now()) } };
      const errs = validateItem(doc, exists);
      if (errs.length) { audit.log('Manage', actorOf(p), 'Update refused', `${id}: ${errs[0]}`, false); fail(400, 'item does not meet the catalogue model', { errors: errs }); }
      const label = doc.accessPolicyLabel?.value ?? null;
      let policy = r.policy ? JSON.parse(r.policy) : null;
      if (label && policy && policy.label !== label) policy = { ...policy, label, A: { ...T4_TO_T3[label] }, version: policy.version + 1 };
      q.run(db, 'UPDATE items SET doc=?, label=?, policy=?, modified_at=? WHERE id=?', JSON.stringify(doc), label, policy && JSON.stringify(policy), iso(Date.now()), id);
      audit.log('Manage', actorOf(p), 'Item updated', id);
      notify.changed(id, 'was updated');
      return api.get(id);
    },
    remove(id, p) {
      const r = row(id); need(r, 404, 'no such item'); assertOwner(r, p, 'delete');
      const dependants = api.all().filter(i => ['provider', 'resourceServer', 'resourceServerGroup'].some(k => i.doc[k]?.value === id) || i.data?.src === id);
      need(!dependants.length, 409, `other items refer to this one: ${dependants.slice(0, 3).map(i => i.id).join(', ')}`);
      tx(db, () => {
        q.run(db, 'UPDATE items SET deleted=1, modified_at=? WHERE id=?', iso(Date.now()), id);
        q.run(db, 'UPDATE tokens SET revoked_at=? WHERE revoked_at IS NULL AND items LIKE ?', iso(Date.now()), `%"${id}"%`);
      });
      audit.log('Manage', actorOf(p), 'Item deleted', id);
      notify.changed(id, 'was deleted');
    },

    // Discover: text, attribute, geo and time search (BIS Table 2, 4.5.1).
    search(f = {}) {
      let items = api.all(f.type ? String(f.type) : undefined);
      const text = str(f.q).toLowerCase();
      if (text) items = items.filter(i => [i.doc.name?.value, i.doc.itemDescription?.value, ...(i.doc.tags?.value || [])].join(' ').toLowerCase().includes(text));
      if (f.attr) {
        const vals = String(f.value ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        items = items.filter(i => {
          const v = i.doc[String(f.attr)]?.value;
          const list = (Array.isArray(v) ? v : [v]).map(x => String(typeof x === 'object' ? JSON.stringify(x) : x).toLowerCase());
          return vals.length ? vals.some(x => list.includes(x)) : v !== undefined;
        });
      }
      if (f.bbox) {
        const b = String(f.bbox).split(',').map(Number);
        need(b.length === 4 && b.every(Number.isFinite), 400, 'bbox must be west,south,east,north');
        items = items.filter(i => { const bb = itemBbox(i.doc); return bb && bb[0] <= b[2] && bb[2] >= b[0] && bb[1] <= b[3] && bb[3] >= b[1]; });
      }
      if (f.near) {
        const [lon, lat, km] = String(f.near).split(',').map(Number);
        need([lon, lat, km].every(Number.isFinite), 400, 'near must be lon,lat,radiusKm');
        items = items.filter(i => { const c = i.doc.location?.value?.geometry?.coordinates; return c && distKm(c, [lon, lat]) <= km; });
      }
      if (f.time) {
        const t = Date.parse(f.time); need(!isNaN(t), 400, 'time must be ISO 8601');
        const rel = f.timerel || 'after';
        need(['after', 'before'].includes(rel), 400, 'timerel must be after or before');
        items = items.filter(i => { const c = Date.parse(i.doc.modifiedAt?.value || i.doc.createdAt?.value); return rel === 'after' ? c >= t : c <= t; });
      }
      const total = items.length;
      const off = Math.max(0, Number(f.offset) || 0), lim = Math.min(500, Math.max(1, Number(f.limit) || 100));
      return { total, results: items.slice(off, off + lim).map(i => i.doc) };
    },
    count: f => api.search({ ...f, limit: 1 }).total,
    stats() { return q.all(db, 'SELECT item_type, COUNT(*) n FROM items WHERE deleted=0 GROUP BY item_type'); },
    // helpers for seeding
    base(type, id, name, desc, tags) {
      return { '@context': CTX, id, itemType: { type: 'Property', value: type }, name: { type: 'Property', value: name }, itemDescription: { type: 'Property', value: desc }, tags: { type: 'Property', value: tags }, refBaseSchema: { type: 'Relationship', value: `<catalogue-link>/${type}_schema.json` } };
    },
  };
  return api;
}

export function itemBbox(doc) {
  const g = doc.location?.value?.geometry || doc.coverageRegion?.value?.geometry;
  if (!g) return null;
  const pts = g.type === 'Point' ? [g.coordinates] : g.coordinates.flat(g.type === 'Polygon' ? 1 : 2);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
export function distKm(a, b) { const dx = (a[0] - b[0]) * 111.32 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180), dy = (a[1] - b[1]) * 110.57; return Math.hypot(dx, dy); }
export { LABELS };
