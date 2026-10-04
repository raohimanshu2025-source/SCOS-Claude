// MQTT 5.0 over TLS for streams (BIS 6.5 AsyncAPI access objects; BIS-92). A tiny client is written here so
// the test needs no package: CONNECT with the DX certificate, SUBSCRIBE to item ids, PUBLISH as the provider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { startCity } from './helpers.js';
import { topicMatches } from '../src/dx/mqtt.js';

let c;
before(async () => { c = await startCity(); });
after(async () => { await c.stop(); });

const varint = n => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; o.push(b); } while (n > 0); return Buffer.from(o); };
const str = s => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
const pkt = (type, flags, body) => Buffer.concat([Buffer.from([(type << 4) | flags]), varint(body.length), body]);

// Connects and returns helpers; packets received are parsed into { type, body }.
function client({ as, token, v = 5 }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: '127.0.0.1', port: c.app.mqttAddress.port, ca: c.ca, servername: 'localhost', ALPNProtocols: ['mqtt'], ...(as ? c.creds(as) : {}) });
    const got = []; let buf = Buffer.alloc(0); const waiters = [];
    const prop = v === 5 ? Buffer.from([0]) : Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        let m = 1, len = 0, k = 1, b;
        do { if (k >= buf.length) return; b = buf[k++]; len += (b & 127) * m; m *= 128; } while (b & 128);
        if (buf.length < k + len) return;
        got.push({ type: buf[0] >> 4, body: buf.subarray(k, k + len) }); buf = buf.subarray(k + len);
        for (const w of [...waiters]) w();
      }
    });
    sock.on('error', reject);
    const wait = (pred, ms = 4000) => new Promise((res, rej) => {
      const check = () => { const i = got.findIndex(pred); if (i >= 0) { clearTimeout(t); waiters.splice(waiters.indexOf(check), 1); res(got.splice(i, 1)[0]); return true; } return false; };
      const t = setTimeout(() => { waiters.splice(waiters.indexOf(check), 1); rej(new Error('timeout waiting for packet')); }, ms);
      waiters.push(check); check();
    });
    const publishes = () => got.filter(x => x.type === 3).map(x => { const n = x.body.readUInt16BE(0); const topic = x.body.toString('utf8', 2, 2 + n); const off = 2 + n + (v === 5 ? 1 : 0); return { topic, data: JSON.parse(x.body.toString('utf8', off)) }; });
    sock.once('secureConnect', async () => {
      const flags = 2 | (token ? 0x80 | 0x40 : 0);
      sock.write(pkt(1, 0, Buffer.concat([str('MQTT'), Buffer.from([v, flags, 0, 60]), prop, str('test-' + v), ...(token ? [str('token'), str(token)] : [])])));
      const ack = await wait(x => x.type === 2);
      resolve({
        sock, ack, wait, publishes,
        async subscribe(id, ...filters) {
          sock.write(pkt(8, 2, Buffer.concat([Buffer.from([0, id]), prop, ...filters.map(f => Buffer.concat([str(f), Buffer.from([0])]))])));
          const s = await wait(x => x.type === 9 && x.body[1] === id);
          return [...s.body.subarray(v === 5 ? 3 : 2)];
        },
        async publish(id, topic, data) {
          sock.write(pkt(3, 2, Buffer.concat([str(topic), Buffer.from([0, id]), prop, Buffer.from(JSON.stringify(data))])));
          const a = await wait(x => x.type === 4 && x.body[1] === id);
          return v === 5 ? a.body[2] ?? 0 : 0;
        },
        end() { sock.end(); },
      });
    });
  });
}

test('[BIS-92] topic filters follow the MQTT rules', () => {
  assert.ok(topicMatches('urn:demo-cat:aqm/+', 'urn:demo-cat:aqm/aqm-1'));
  assert.ok(topicMatches('#', 'urn:demo-cat:aqm/aqm-1'));
  assert.ok(!topicMatches('urn:demo-cat:aqm/+', 'urn:demo-cat:drains/drain-1'));
  assert.ok(!topicMatches('urn:demo-cat:aqm', 'urn:demo-cat:aqm/aqm-1'));
});

test('[BIS-92] MQTT 5.0 over TLS: a public group streams its latest and new packets', async () => {
  const m = await client({ as: 'control@mc.demo-city.example' });
  assert.equal(m.ack.body[1], 0, 'CONNACK success');
  const codes = await m.subscribe(1, 'urn:demo-cat:aqm/+');
  assert.deepEqual(codes, [0]);
  await new Promise(r => setTimeout(r, 200));
  const first = m.publishes();
  assert.ok(first.length >= 2 && first.every(p => p.topic.startsWith('urn:demo-cat:aqm/') && 'PM2_5' in p.data), 'latest packet of each sensor at once');
  // the provider publishes a new packet over MQTT; it is ingested and reaches the subscriber
  const prov = await client({ as: 'officer@pcc.demo-city.example' });
  const t = new Date().toISOString();
  assert.equal(await prov.publish(7, 'urn:demo-cat:aqm/aqm-1', { PM2_5: 77.5, CO2_MAX: 420, TEMPERATURE_MAX: 31, NAME: 'Air quality sensor 1', LASTUPDATEDATETIME: t }), 0);
  c.app.mqtt.tick();
  await new Promise(r => setTimeout(r, 200));
  assert.ok(m.publishes().some(p => p.topic === 'urn:demo-cat:aqm/aqm-1' && p.data.PM2_5 === 77.5), 'new packet delivered');
  // a data model check failure and a non-owner are refused
  assert.equal(await prov.publish(8, 'urn:demo-cat:aqm/aqm-1', { PM2_5: 'high', LASTUPDATEDATETIME: t }), 0x99);
  const other = await client({ as: 'officer@wd.demo-city.example' });
  assert.equal(await other.publish(9, 'urn:demo-cat:aqm/aqm-1', { PM2_5: 50, LASTUPDATEDATETIME: t }), 0x87);
  m.end(); prov.end(); other.end();
});

test('[BIS-92] protected items need a DX token as the MQTT password; MQTT 3.1.1 also works', async () => {
  const no = await client({ as: 'control@mc.demo-city.example' });
  assert.deepEqual(await no.subscribe(1, 'urn:demo-cat:drains/drain-3', 'urn:demo-cat:nothing/+'), [0x87, 0x8f], 'not authorised, then no matching item');
  no.end();
  const tok = (await c.req('POST', '/auth/v1/token', { as: 'control@mc.demo-city.example', body: { request: [{ id: 'urn:demo-cat:drains/drain-3' }] } })).body.token;
  assert.ok(tok);
  const yes = await client({ as: 'control@mc.demo-city.example', token: tok, v: 4 });
  assert.equal(yes.ack.body[1], 0);
  assert.deepEqual(await yes.subscribe(2, 'urn:demo-cat:drains/+'), [0], 'allowed for the item the token covers');
  yes.end();
  // the token is bound to its certificate: another holder cannot use it
  const thief = await client({ as: 'officer@pcc.demo-city.example', token: tok });
  assert.deepEqual(await thief.subscribe(3, 'urn:demo-cat:drains/drain-3'), [0x87]);
  thief.end();
  const admin = await c.login('admin');
  const log = await admin.as('GET', '/ops/v1/audit?iface=Resource&limit=200');
  assert.equal(log.status, 200);
  assert.ok(log.body.some(e => e.action === 'MQTT subscribe' && !e.ok), 'refusals are audited');
});

test('[BIS-92] AsyncAPI 2.6 document for a group points to the MQTT server and the data model', async () => {
  const r = await c.req('GET', '/catalogue/v1/asyncapi?id=' + encodeURIComponent('urn:demo-cat:group/itms'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.asyncapi, '2.6.0');
  assert.equal(r.body.servers.dx.protocol, 'mqtts');
  assert.ok(r.body.servers.dx.url.endsWith(':' + c.app.mqttAddress.port));
  const ch = Object.keys(r.body.channels);
  assert.ok(ch.length >= 2 && ch.every(k => k.startsWith('urn:demo-cat:itms/')));
  assert.match(r.body.channels[ch[0]].subscribe.message.payload.$ref, /datamodels\?name=busPosition$/);
  assert.equal((await c.req('GET', '/catalogue/v1/asyncapi?id=nothing')).status, 404);
});
