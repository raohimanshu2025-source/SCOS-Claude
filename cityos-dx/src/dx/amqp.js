// AMQP 1.0 over TLS for resource streams (BIS 6.5 and the referenced standard ISO/IEC 19464, OASIS AMQP 1.0).
// A small broker inside the data exchange, next to MQTT. Clients connect with their DX certificate (mutual TLS)
// and give a DX access token as the SASL PLAIN password for protected items (SASL ANONYMOUS and EXTERNAL are
// accepted for public items). Addresses are resource item ids or resource group ids.
// - A receiving link on an item or group gets that item's new data packets, checked with the same rules as the
//   resource server (Figure 2) when the link is attached and again every minute.
// - A sending link to an item id is an ingest by the item's provider, checked against the data model; each
//   unsettled message is answered with accepted or rejected.
// Supported: SASL (PLAIN, ANONYMOUS, EXTERNAL), open, begin, attach, flow (link credit), transfer, disposition,
// detach, end, close, empty heartbeat frames. Not supported: transactions, link recovery, multi-frame outgoing
// messages (data packets are small), and queues that outlive a connection.
import tls from 'node:tls';
import { q } from '../db.js';
import { actorOf } from '../identity/identity.js';

// ---- AMQP 1.0 type system (Part 1) ----
// Values to encode: null, boolean, string, Buffer (binary), arrays (list), and tagged values for the other types.
export const A = {
  uint: v => ({ t: 'uint', v }), ulong: v => ({ t: 'ulong', v }), ubyte: v => ({ t: 'ubyte', v }), ushort: v => ({ t: 'ushort', v }),
  sym: v => ({ t: 'sym', v }), syms: v => ({ t: 'syms', v }), map: v => ({ t: 'map', v }), desc: (d, v) => ({ t: 'desc', d, v }),
};
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const vbin = (small, big, b) => (b.length < 256 ? Buffer.concat([Buffer.from([small, b.length]), b]) : Buffer.concat([Buffer.from([big]), u32(b.length), b]));
const compound = (code, items) => { const body = Buffer.concat(items.map(encode)); return Buffer.concat([Buffer.from([code]), u32(body.length + 4), u32(items.length), body]); };

export function encode(x) {
  if (x === null || x === undefined) return Buffer.from([0x40]);
  if (x === true) return Buffer.from([0x41]);
  if (x === false) return Buffer.from([0x42]);
  if (typeof x === 'string') return vbin(0xa1, 0xb1, Buffer.from(x, 'utf8'));
  if (Buffer.isBuffer(x)) return vbin(0xa0, 0xb0, x);
  if (Array.isArray(x)) return x.length ? compound(0xd0, x) : Buffer.from([0x45]);
  if (typeof x === 'number') return Number.isInteger(x) && x >= 0 && x < 2 ** 32 ? encode(A.uint(x)) : (() => { const b = Buffer.alloc(9); b[0] = 0x82; b.writeDoubleBE(x, 1); return b; })();
  switch (x.t) {
    case 'uint': return x.v === 0 ? Buffer.from([0x43]) : x.v < 256 ? Buffer.from([0x52, x.v]) : Buffer.concat([Buffer.from([0x70]), u32(x.v)]);
    case 'ulong': { if (x.v === 0) return Buffer.from([0x44]); if (x.v < 256) return Buffer.from([0x53, x.v]); const b = Buffer.alloc(9); b[0] = 0x80; b.writeBigUInt64BE(BigInt(x.v), 1); return b; }
    case 'ubyte': return Buffer.from([0x50, x.v]);
    case 'ushort': return Buffer.from([0x60, x.v >> 8, x.v & 255]);
    case 'sym': return vbin(0xa3, 0xb3, Buffer.from(x.v, 'ascii'));
    case 'syms': { const body = Buffer.concat(x.v.map(s => { const b = Buffer.from(s, 'ascii'); return Buffer.concat([u32(b.length), b]); })); return Buffer.concat([Buffer.from([0xf0]), u32(body.length + 5), u32(x.v.length), Buffer.from([0xb3]), body]); }
    case 'map': return compound(0xd1, x.v.flat());
    case 'desc': return Buffer.concat([Buffer.from([0x00]), encode(A.ulong(x.d)), encode(x.v)]);
  }
  throw new Error('cannot encode ' + JSON.stringify(x));
}

// Decodes one value at `i`; returns [value, next index]. Described values become {d, v}; maps become objects.
export function decode(b, i = 0) {
  const c = b[i++];
  const fixed = (n, f) => [f(i), i + n];
  const vlen = big => { const n = big ? b.readUInt32BE(i) : b[i]; const s = i + (big ? 4 : 1); return [b.subarray(s, s + n), s + n]; };
  switch (c) {
    case 0x00: { const [d, j] = decode(b, i); const [v, k] = decode(b, j); return [{ d, v }, k]; }
    case 0x40: return [null, i];
    case 0x41: return [true, i]; case 0x42: return [false, i]; case 0x56: return [b[i] === 1, i + 1];
    case 0x43: case 0x44: return [0, i];
    case 0x50: case 0x52: case 0x53: return [b[i], i + 1];
    case 0x51: case 0x54: case 0x55: return [b.readInt8(i), i + 1];
    case 0x60: return fixed(2, j => b.readUInt16BE(j)); case 0x61: return fixed(2, j => b.readInt16BE(j));
    case 0x70: return fixed(4, j => b.readUInt32BE(j)); case 0x71: return fixed(4, j => b.readInt32BE(j));
    case 0x72: return fixed(4, j => b.readFloatBE(j)); case 0x73: return fixed(4, j => String.fromCodePoint(b.readUInt32BE(j)));
    case 0x80: return fixed(8, j => Number(b.readBigUInt64BE(j))); case 0x81: case 0x83: return fixed(8, j => Number(b.readBigInt64BE(j)));
    case 0x82: return fixed(8, j => b.readDoubleBE(j));
    case 0x74: return [b.subarray(i, i + 4), i + 4]; case 0x84: return [b.subarray(i, i + 8), i + 8]; case 0x94: case 0x98: return [b.subarray(i, i + 16), i + 16];
    case 0xa0: case 0xb0: { const [v, j] = vlen(c === 0xb0); return [Buffer.from(v), j]; }
    case 0xa1: case 0xb1: case 0xa3: case 0xb3: { const [v, j] = vlen(c & 0x10); return [v.toString('utf8'), j]; }
    case 0x45: return [[], i];
    case 0xc0: case 0xc1: case 0xd0: case 0xd1: {
      const big = c >= 0xd0, size = big ? b.readUInt32BE(i) : b[i], n = big ? b.readUInt32BE(i + 4) : b[i + 1], end = i + (big ? 4 : 1) + size;
      let j = i + (big ? 8 : 2); const out = [];
      for (let k = 0; k < n; k++) { const [v, nx] = decode(b, j); out.push(v); j = nx; }
      if (c === 0xc1 || c === 0xd1) { const o = {}; for (let k = 0; k < out.length; k += 2) o[String(out[k])] = out[k + 1]; return [o, end]; }
      return [out, end];
    }
    case 0xe0: case 0xf0: {
      const big = c === 0xf0, size = big ? b.readUInt32BE(i) : b[i], n = big ? b.readUInt32BE(i + 4) : b[i + 1], end = i + (big ? 4 : 1) + size;
      let j = i + (big ? 8 : 2); const ctor = j; const out = [];
      // every element shares the constructor: decode each by putting the constructor in front of it
      let k = ctor + 1;
      if (b[ctor] === 0x00) throw new Error('described arrays are not supported');
      for (let m = 0; m < n; m++) { const tmp = Buffer.concat([Buffer.from([b[ctor]]), b.subarray(k, end)]); const [v, nx] = decode(tmp, 0); out.push(v); k += nx - 1; }
      return [out, end];
    }
  }
  throw new Error('unsupported AMQP type code 0x' + c.toString(16));
}

// ---- frames and performatives (Part 2) ----
export const P = { open: 0x10, begin: 0x11, attach: 0x12, flow: 0x13, transfer: 0x14, disposition: 0x15, detach: 0x16, end: 0x17, close: 0x18, error: 0x1d,
  source: 0x28, target: 0x29, accepted: 0x24, rejected: 0x25, saslMechanisms: 0x40, saslInit: 0x41, saslOutcome: 0x44,
  properties: 0x73, appProperties: 0x74, data: 0x75, amqpSequence: 0x76, amqpValue: 0x77 };
export const HDR_SASL = Buffer.from([65, 77, 81, 80, 3, 1, 0, 0]), HDR_AMQP = Buffer.from([65, 77, 81, 80, 0, 1, 0, 0]);
export function frame(type, channel, perf, payload = Buffer.alloc(0)) {
  const body = Buffer.concat([perf ? encode(perf) : Buffer.alloc(0), payload]);
  const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h[4] = 2; h[5] = type; h.writeUInt16BE(channel, 6);
  return Buffer.concat([h, body]);
}
// Splits a frame body into the performative ({code, fields}) and the rest (message payload of a transfer).
export function parseFrameBody(body) {
  if (!body.length) return null; // heartbeat
  const [p, j] = decode(body, 0);
  return { code: p.d, f: p.v || [], payload: body.subarray(j) };
}
const err = (condition, description) => A.desc(P.error, [A.sym(condition), description]);

export function makeAmqp({ db, cfg, identity, resource, catalogue, audit, tlsOptions }) {
  const conns = new Set();
  const server = tls.createServer({ ...tlsOptions() }, sock => connection(sock));
  let timer = null;

  function connection(sock) {
    const c = { sock, stage: 'header', p: null, token: null, buf: Buffer.alloc(0), sessions: new Map(), maxFrame: 65536 };
    conns.add(c);
    const close = () => { conns.delete(c); sock.destroy(); };
    sock.on('error', close); sock.on('close', () => conns.delete(c));
    sock.on('data', d => {
      c.buf = Buffer.concat([c.buf, d]);
      try {
        while (true) {
          if (c.stage === 'header' || c.stage === 'header2') {
            if (c.buf.length < 8) return;
            const h = c.buf.subarray(0, 8); c.buf = c.buf.subarray(8);
            if (c.stage === 'header' && h.equals(HDR_SASL)) { send(c, HDR_SASL); send(c, frame(1, 0, A.desc(P.saslMechanisms, [A.syms(['PLAIN', 'ANONYMOUS', 'EXTERNAL'])]))); c.stage = 'sasl'; continue; }
            if (h.equals(HDR_AMQP) && (c.stage === 'header2' || c.stage === 'header')) {
              if (!c.p) c.p = identity.principal({ socket: c.sock, headers: {} }, null);
              send(c, HDR_AMQP); c.stage = 'open'; continue;
            }
            send(c, HDR_SASL); return c.sock.end(); // unsupported protocol: answer with the one we speak, then close
          }
          if (c.buf.length < 8) return;
          const size = c.buf.readUInt32BE(0);
          if (size < 8 || size > 1 << 20) return close();
          if (c.buf.length < size) return;
          const doff = c.buf[4] * 4, type = c.buf[5], ch = c.buf.readUInt16BE(6), body = c.buf.subarray(doff, size);
          c.buf = c.buf.subarray(size);
          const f = parseFrameBody(body);
          if (!f) continue; // empty frame: heartbeat
          if (c.stage === 'sasl') { saslFrame(c, type, f); continue; }
          if (type !== 0) throw new Error('AMQP frame expected');
          handle(c, ch, f);
          if (sock.destroyed) return;
        }
      } catch (e) { audit.log('Resource', c.p ? actorOf(c.p) : 'anonymous', 'AMQP protocol error', String(e.message), false); close(); }
    });
  }

  const send = (c, b) => { if (!c.sock.destroyed) c.sock.write(b); };
  const out = (c, ch, code, fields, payload) => send(c, frame(0, ch, A.desc(code, fields), payload));

  function saslFrame(c, type, f) {
    if (type !== 1 || f.code !== P.saslInit) throw new Error('sasl-init expected');
    const [mech, resp] = f.f;
    c.p = identity.principal({ socket: c.sock, headers: {} }, null);
    if (mech === 'PLAIN' && Buffer.isBuffer(resp)) { const parts = resp.toString('utf8').split('\0'); c.token = parts[2] || null; } // the password is the DX token
    const ok = ['PLAIN', 'ANONYMOUS', 'EXTERNAL'].includes(mech) && (mech !== 'EXTERNAL' || c.p.email);
    send(c, frame(1, 0, A.desc(P.saslOutcome, [A.ubyte(ok ? 0 : 1)])));
    audit.log('Resource', actorOf(c.p), 'AMQP connect', `SASL ${mech}${c.token ? ' with token' : ''}`, ok);
    if (!ok) return c.sock.end();
    c.stage = 'header2';
  }

  // Items behind an address: an item id, or a group id (all its items).
  const itemsOf = addr => catalogue.all('resourceItem').filter(i => i.id === addr || i.doc.resourceServerGroup?.value === addr).map(i => i.id);

  function handle(c, ch, { code, f, payload }) {
    if (code === P.open) {
      if (Number.isFinite(f[2])) c.maxFrame = Math.max(512, f[2]);
      c.stage = 'opened';
      return out(c, 0, P.open, ['cityos-dx', null, A.uint(65536), A.ushort(255)]);
    }
    if (c.stage !== 'opened') throw new Error('open expected');
    if (code === P.close) { out(c, 0, P.close, []); return c.sock.end(); }
    if (code === P.begin) {
      const s = { ch, links: new Map(), nextOut: 0, nextIn: f[1] ?? 0 };
      c.sessions.set(ch, s);
      return out(c, ch, P.begin, [A.ushort(ch), A.uint(0), A.uint(5000), A.uint(5000)]);
    }
    const s = c.sessions.get(ch); if (!s) throw new Error('no session on channel ' + ch);
    if (code === P.end) { c.sessions.delete(ch); return out(c, ch, P.end, []); }
    if (code === P.attach) return attach(c, s, f);
    if (code === P.flow) {
      if (f[4] == null) return; // session flow only
      const l = s.links.get(f[4]); if (!l || l.role !== 'sender') return;
      l.credit = (f[5] ?? l.deliveryCount) + (f[6] ?? 0) - l.deliveryCount;
      if (!l.primed) { l.primed = true; for (const t of l.items) { const r = q.get(db, 'SELECT data FROM readings WHERE item_id=? ORDER BY ts DESC LIMIT 1', t); if (r) deliver(c, s, l, t, r.data); } }
      return;
    }
    if (code === P.transfer) return transfer(c, s, f, payload);
    if (code === P.disposition) return; // our outgoing messages are sent settled
    if (code === P.detach) { if (!s.links.delete(f[0])) return; return out(c, ch, P.detach, [A.uint(f[0]), true]); } // links this broker detached first need no answer
    throw new Error('unsupported performative 0x' + Number(code).toString(16));
  }

  function attach(c, s, f) {
    const [name, handle, clientIsReceiver, , , source, target] = f;
    const refuse = (role, cond, why) => {
      out(c, s.ch, P.attach, [name, A.uint(handle), role, null, null, null, null, null, null, ...(role === false ? [A.uint(0)] : [])]);
      out(c, s.ch, P.detach, [A.uint(handle), true, err(cond, why)]);
    };
    if (clientIsReceiver) {
      // the client receives: this broker is the sender on an item or group
      const addr = String(source?.v?.[0] ?? '');
      const match = itemsOf(addr);
      const ok = []; let why = '';
      for (const t of match) { try { resource.canRead(c.p, t, c.token); ok.push(t); } catch (e) { why = e.message; } }
      audit.log('Resource', actorOf(c.p), 'AMQP receive link', `${addr}: ${ok.length} of ${match.length} item(s) allowed`, ok.length > 0);
      if (!match.length) return refuse(false, 'amqp:not-found', 'no resource item or group with this address');
      if (!ok.length) return refuse(false, 'amqp:unauthorized-access', why || 'not allowed');
      const l = { role: 'sender', handle, name, items: new Set(ok), credit: 0, deliveryCount: 0, tag: 0, checked: Date.now(), cursor: q.get(db, 'SELECT MAX(rowid) m FROM readings')?.m || 0 };
      s.links.set(handle, l);
      return out(c, s.ch, P.attach, [name, A.uint(handle), false, A.ubyte(1), A.ubyte(0), A.desc(P.source, [addr]), target ? A.desc(P.target, target.v || []) : null, null, null, A.uint(0)]);
    }
    // the client sends: this broker receives data packets for one item
    const addr = String(target?.v?.[0] ?? '');
    const it = catalogue.get(addr);
    if (!it || it.item_type !== 'resourceItem') return refuse(true, 'amqp:not-found', 'the target must be a resource item id');
    const l = { role: 'receiver', handle, name, item: addr, credit: 100, deliveryCount: f[9] ?? 0, partial: null };
    s.links.set(handle, l);
    out(c, s.ch, P.attach, [name, A.uint(handle), true, A.ubyte(0), A.ubyte(0), source ? A.desc(P.source, source.v || []) : null, A.desc(P.target, [addr])]);
    out(c, s.ch, P.flow, [A.uint(s.nextIn), A.uint(5000), A.uint(s.nextOut), A.uint(5000), A.uint(handle), A.uint(l.deliveryCount), A.uint(l.credit)]);
  }

  function transfer(c, s, f, payload) {
    const [handle, deliveryId, , , settled, more] = f;
    const l = s.links.get(handle); if (!l || l.role !== 'receiver') throw new Error('transfer on unknown link');
    if (deliveryId != null) l.partial = { id: deliveryId, settled: !!settled, parts: [] };
    l.partial.parts.push(payload);
    if (more) return;
    const { id, parts } = l.partial; const isSettled = l.partial.settled || !!settled; l.partial = null;
    s.nextIn++; l.deliveryCount++; l.credit--;
    let state;
    try {
      const msg = Buffer.concat(parts); const data = [];
      let body = null;
      for (let j = 0; j < msg.length;) { const [sec, nx] = decode(msg, j); j = nx; if (sec?.d === P.data) data.push(sec.v); else if (sec?.d === P.amqpValue) body = sec.v; }
      const text = data.length ? Buffer.concat(data).toString('utf8') : Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : null;
      if (text == null) throw Object.assign(new Error('the message body must be JSON in a data or amqp-value section'), { status: 400 });
      let packet; try { packet = JSON.parse(text); } catch { throw Object.assign(new Error('the message body is not JSON'), { status: 400 }); }
      resource.ingest(c.p, { id: l.item, data: Array.isArray(packet) ? packet : [packet] });
      state = A.desc(P.accepted, []);
    } catch (e) {
      audit.log('Resource', actorOf(c.p), 'AMQP message refused', `${l.item}: ${e.message}`, false);
      state = A.desc(P.rejected, [err(e.status === 401 || e.status === 403 ? 'amqp:unauthorized-access' : 'amqp:decode-error', String(e.message).slice(0, 300))]);
    }
    if (!isSettled) out(c, s.ch, P.disposition, [true, A.uint(id), A.uint(id), true, state]);
    if (l.credit < 50) { l.credit = 100; out(c, s.ch, P.flow, [A.uint(s.nextIn), A.uint(5000), A.uint(s.nextOut), A.uint(5000), A.uint(l.handle), A.uint(l.deliveryCount), A.uint(l.credit)]); }
  }

  function deliver(c, s, l, item, data) {
    if (l.credit <= 0) return false;
    const msg = Buffer.concat([
      encode(A.desc(P.properties, [null, null, item, item, null, null, A.sym('application/json')])),
      encode(A.desc(P.appProperties, A.map([['item', item]]))),
      encode(A.desc(P.data, Buffer.from(data, 'utf8'))),
    ]);
    const tag = Buffer.alloc(4); tag.writeUInt32BE(l.tag++);
    out(c, s.ch, P.transfer, [A.uint(l.handle), A.uint(s.nextOut++), tag, A.uint(0), true], msg);
    l.deliveryCount++; l.credit--;
    return true;
  }

  // New readings are pushed every second while the link has credit; access is checked again every minute.
  function tick() {
    for (const c of conns) for (const s of c.sessions.values()) for (const l of s.links.values()) {
      if (l.role !== 'sender') continue;
      if (Date.now() - l.checked > 60e3) {
        l.checked = Date.now();
        for (const t of [...l.items]) { try { resource.canRead(c.p, t, c.token); } catch { l.items.delete(t); } }
        if (!l.items.size) { s.links.delete(l.handle); out(c, s.ch, P.detach, [A.uint(l.handle), true, err('amqp:unauthorized-access', 'access ended (token expired or revoked)')]); continue; }
      }
      if (l.credit <= 0) continue;
      const rows = q.all(db, 'SELECT rowid, item_id, data FROM readings WHERE rowid > ? ORDER BY rowid LIMIT 2000', l.cursor);
      for (const r of rows) { if (l.items.has(r.item_id) && !deliver(c, s, l, r.item_id, r.data)) break; l.cursor = r.rowid; }
    }
  }

  return {
    server,
    listen(port, host) {
      return new Promise(res => {
        server.once('error', e => { console.error('AMQP not started:', e.message); res(null); });
        server.listen(port, host, () => { timer = setInterval(tick, 1000); timer.unref(); res(server.address()); });
      });
    },
    close() { clearInterval(timer); for (const c of conns) c.sock.destroy(); return server.listening ? new Promise(r => server.close(() => r())) : Promise.resolve(); },
    tick,
  };
}
