// MQTT over TLS for resource streams (BIS 6.5: AsyncAPI access objects for MQTT; referenced standard MQTT 5.0).
// A small broker inside the data exchange: MQTT 5.0 and 3.1.1 clients connect with their DX certificate
// (mutual TLS, as for HTTPS) and give a DX access token as the password for protected items.
// Topics are resource item ids; "+" and "#" wildcards select several items, for example a whole group.
// Subscribing checks access per item with the same rules as the resource server (Figure 2).
// Publishing to an item id is an ingest by its provider and is checked against the data model.
// Supported packets: CONNECT, PUBLISH (QoS 0 and 1 in, QoS 0 out), PUBACK, SUBSCRIBE, UNSUBSCRIBE, PINGREQ, DISCONNECT.
import tls from 'node:tls';
import { q } from '../db.js';
import { actorOf } from '../identity/identity.js';

const T = { CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, SUBSCRIBE: 8, SUBACK: 9, UNSUBSCRIBE: 10, UNSUBACK: 11, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 };

const varint = n => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; o.push(b); } while (n > 0); return Buffer.from(o); };
const str = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
const packet = (type, flags, body) => Buffer.concat([Buffer.from([(type << 4) | flags]), varint(body.length), body]);

// Reader over one packet body.
function reader(buf) {
  let i = 0;
  return {
    get left() { return buf.length - i; },
    byte: () => buf[i++],
    u16: () => { const v = buf.readUInt16BE(i); i += 2; return v; },
    str: () => { const n = buf.readUInt16BE(i); const s = buf.toString('utf8', i + 2, i + 2 + n); i += 2 + n; return s; },
    bin: () => { const n = buf.readUInt16BE(i); const s = buf.subarray(i + 2, i + 2 + n); i += 2 + n; return s; },
    varint: () => { let m = 1, v = 0, b; do { b = buf[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; },
    skip: n => { i += n; },
    rest: () => buf.subarray(i),
  };
}

// MQTT topic filter match (OASIS MQTT 5.0, 4.7).
export function topicMatches(filter, topic) {
  const f = filter.split('/'), t = topic.split('/');
  for (let k = 0; k < f.length; k++) {
    if (f[k] === '#') return true;
    if (k >= t.length) return false;
    if (f[k] !== '+' && f[k] !== t[k]) return false;
  }
  return f.length === t.length;
}

export function makeMqtt({ db, cfg, identity, resource, catalogue, audit, tlsOptions }) {
  const conns = new Set();
  const server = tls.createServer({ ...tlsOptions(), ALPNProtocols: ['mqtt'] }, sock => connection(sock));
  let timer = null;

  function connection(sock) {
    const c = { sock, v: 4, p: null, token: null, subs: new Map(), cursor: 0, checked: 0, buf: Buffer.alloc(0), connected: false };
    conns.add(c);
    const close = () => { conns.delete(c); sock.destroy(); };
    sock.on('error', close); sock.on('close', () => conns.delete(c));
    sock.on('data', d => {
      c.buf = Buffer.concat([c.buf, d]);
      while (c.buf.length >= 2) {
        let m = 1, len = 0, k = 1, b;
        do { if (k >= c.buf.length) return; b = c.buf[k++]; len += (b & 127) * m; m *= 128; } while (b & 128);
        if (len > 1 << 20) return close();
        if (c.buf.length < k + len) return;
        const head = c.buf[0], body = c.buf.subarray(k, k + len);
        c.buf = c.buf.subarray(k + len);
        try { handle(c, head >> 4, head & 15, body); } catch (e) { audit.log('Resource', c.p ? actorOf(c.p) : 'anonymous', 'MQTT protocol error', String(e.message), false); return close(); }
        if (sock.destroyed) return;
      }
    });
  }

  const send = (c, b) => { if (!c.sock.destroyed) c.sock.write(b); };
  const props = c => (c.v === 5 ? Buffer.from([0]) : Buffer.alloc(0)); // empty MQTT 5 property list

  function handle(c, type, flags, body) {
    const r = reader(body);
    if (!c.connected && type !== T.CONNECT) throw new Error('first packet must be CONNECT');
    if (type === T.CONNECT) {
      const proto = r.str(); c.v = r.byte();
      if (proto !== 'MQTT' || ![4, 5].includes(c.v)) { send(c, packet(T.CONNACK, 0, Buffer.from(c.v === 5 ? [0, 0x84, 0] : [0, 1]))); return c.sock.end(); }
      const f = r.byte(); r.u16(); // keep alive
      if (c.v === 5) r.skip(r.varint());
      r.str(); // client id
      if (f & 4) { if (c.v === 5) r.skip(r.varint()); r.str(); r.bin(); } // will: not kept
      if (f & 128) r.str(); const pass = f & 64 ? r.bin().toString('utf8') : null;
      c.p = identity.principal({ socket: c.sock, headers: {} }, null);
      c.token = pass || null; // user name is not used; the password carries the DX access token
      c.connected = true;
      audit.log('Resource', actorOf(c.p), 'MQTT connect', `MQTT ${c.v === 5 ? '5.0' : '3.1.1'}${c.token ? ' with token' : ''}`);
      return send(c, packet(T.CONNACK, 0, Buffer.concat([Buffer.from([0, 0]), props(c)])));
    }
    if (type === T.SUBSCRIBE) {
      const id = r.u16(); if (c.v === 5) r.skip(r.varint());
      const codes = [];
      const items = catalogue.all('resourceItem').map(i => i.id);
      while (r.left > 0) {
        const filter = r.str(); r.byte();
        const match = items.filter(t => topicMatches(filter, t));
        const ok = [];
        for (const t of match) { try { resource.canRead(c.p, t, c.token); ok.push(t); } catch { /* not allowed: left out */ } }
        if (!match.length) codes.push(c.v === 5 ? 0x8f : 0x80);
        else if (!ok.length) codes.push(c.v === 5 ? 0x87 : 0x80);
        else { c.subs.set(filter, new Set(ok)); codes.push(0); }
        audit.log('Resource', actorOf(c.p), 'MQTT subscribe', `${filter}: ${ok.length} of ${match.length} item(s) allowed`, ok.length > 0);
        // the latest packet of each allowed item is sent at once, like a retained message
        for (const t of ok) { const l = q.get(db, 'SELECT rowid, data FROM readings WHERE item_id=? ORDER BY ts DESC LIMIT 1', t); if (l) deliver(c, t, l.data); }
      }
      if (!c.cursor) c.cursor = q.get(db, 'SELECT MAX(rowid) m FROM readings')?.m || 0;
      return send(c, packet(T.SUBACK, 0, Buffer.concat([Buffer.from([id >> 8, id & 255]), props(c), Buffer.from(codes)])));
    }
    if (type === T.UNSUBSCRIBE) {
      const id = r.u16(); if (c.v === 5) r.skip(r.varint());
      const codes = []; while (r.left > 0) { c.subs.delete(r.str()); codes.push(0); }
      return send(c, packet(T.UNSUBACK, 0, Buffer.concat([Buffer.from([id >> 8, id & 255]), ...(c.v === 5 ? [props(c), Buffer.from(codes)] : [])])));
    }
    if (type === T.PUBLISH) {
      const qos = (flags >> 1) & 3; const topic = r.str(); const id = qos ? r.u16() : 0; if (c.v === 5) r.skip(r.varint());
      let reason = 0;
      try {
        const data = JSON.parse(r.rest().toString('utf8'));
        resource.ingest(c.p, { id: topic, data: Array.isArray(data) ? data : [data] });
      } catch (e) { reason = e.status === 403 || e.status === 401 ? 0x87 : 0x99; audit.log('Resource', actorOf(c.p), 'MQTT publish refused', `${topic}: ${e.message}`, false); }
      if (qos === 1) send(c, packet(T.PUBACK, 0, Buffer.from(c.v === 5 ? [id >> 8, id & 255, reason] : [id >> 8, id & 255])));
      return;
    }
    if (type === T.PINGREQ) return send(c, packet(T.PINGRESP, 0, Buffer.alloc(0)));
    if (type === T.DISCONNECT) return c.sock.end();
    if (type === T.PUBACK) return;
    throw new Error('unsupported packet type ' + type);
  }

  function deliver(c, topic, data) {
    send(c, packet(T.PUBLISH, 0, Buffer.concat([str(topic), props(c), Buffer.from(data, 'utf8')])));
  }

  // New readings are pushed every second; access is checked again every minute so a revoked or expired token stops the flow.
  function tick() {
    for (const c of conns) {
      if (!c.subs.size) continue;
      if (Date.now() - c.checked > 60e3) {
        c.checked = Date.now();
        for (const set of c.subs.values()) for (const t of [...set]) { try { resource.canRead(c.p, t, c.token); } catch { set.delete(t); } }
      }
      const want = new Set([...c.subs.values()].flatMap(s => [...s]));
      if (!want.size) continue;
      const rows = q.all(db, 'SELECT rowid, item_id, data FROM readings WHERE rowid > ? ORDER BY rowid LIMIT 2000', c.cursor);
      for (const row of rows) { c.cursor = row.rowid; if (want.has(row.item_id)) deliver(c, row.item_id, row.data); }
    }
  }

  return {
    server,
    listen(port, host) {
      // A busy port (for example a second copy of the server) leaves MQTT off instead of stopping the DX.
      return new Promise(res => {
        server.once('error', e => { console.error('MQTT not started:', e.message); res(null); });
        server.listen(port, host, () => { timer = setInterval(tick, 1000); timer.unref(); res(server.address()); });
      });
    },
    close() { clearInterval(timer); for (const c of conns) c.sock.destroy(); return server.listening ? new Promise(r => server.close(() => r())) : Promise.resolve(); },
    tick,
  };
}

// AsyncAPI 2.6 document for one resource item or group (BIS 6.5: AsyncAPI access objects for event-driven APIs).
export function asyncApiDoc({ cfg, catalogue, id, port }) {
  const item = catalogue.doc(id);
  if (!item) return null;
  const members = catalogue.all('resourceItem').filter(i => i.id === id || i.doc.resourceServerGroup?.value === id).map(i => catalogue.doc(i.id));
  const channels = {};
  for (const m of members) {
    const model = m.refDataModel?.value;
    channels[m.id] = {
      description: m.description?.value || m.label?.value || m.id,
      subscribe: { operationId: 'receive_' + m.id.replace(/\W+/g, '_').slice(-60), summary: 'New data packets of this item', message: { contentType: 'application/json', payload: { $ref: model ? `https://${cfg.publicName}/catalogue/v1/datamodels?name=${encodeURIComponent(model.split('/').slice(-2, -1)[0])}` : '#' } } },
      publish: { operationId: 'send_' + m.id.replace(/\W+/g, '_').slice(-60), summary: 'Data provider of this item only: add data packets (checked against the data model)' },
      bindings: { mqtt: { bindingVersion: '0.2.0' } },
    };
  }
  return {
    asyncapi: '2.6.0',
    info: { title: `Streams for ${item.label?.value || id}`, version: '1.0.0', description: 'MQTT 5.0 over TLS. Connect with your DX certificate; for protected items give a DX access token as the MQTT password. Demo data.' },
    servers: { dx: { url: `${cfg.publicName}:${port}`, protocol: 'mqtts', protocolVersion: '5.0', description: 'Mutual TLS with the DX certificate; MQTT 3.1.1 is also accepted', security: [{ dxToken: [] }] } },
    components: { securitySchemes: { dxToken: { type: 'userPassword', description: 'Password = access token from the DX authorization service (any user name). Public items need no token.' } } },
    defaultContentType: 'application/json',
    channels,
  };
}
