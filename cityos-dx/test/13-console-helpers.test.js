// Console helpers: the administrator adds a department and a person, and the new officer publishes a dataset
// and its data from the console, all under the normal BIS 5.4.2 and catalogue rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCity, PASSWORD } from './helpers.js';

let c, admin;
before(async () => { c = await startCity(); admin = await c.login('admin'); });
after(() => c.stop());

test('the administrator adds a department and a data officer; the officer logs in, sets a password and publishes a dataset with data', async () => {
  const d = await admin.as('POST', '/identity/v1/departments', { body: { id: 'kjs', name: 'Jal Sansthan (demo)', domain: 'kjs.demo-city.example' } });
  assert.equal(d.status, 201, JSON.stringify(d.body)); assert.equal(d.body.org.whitelisted, 1); assert.ok(d.body.orgCertificate);

  const bad = await admin.as('POST', '/identity/v1/people', { body: { name: 'Outsider', email: 'x@nowhere.example', kind: 'officer', cls: 3, role: 'provider', username: 'outsider', password: PASSWORD } });
  assert.equal(bad.status, 403, 'a domain that no registered department owns is refused (BIS 5.4.2)');
  const wrongCls = await admin.as('POST', '/identity/v1/people', { body: { name: 'Officer', email: 'ee@kjs.demo-city.example', kind: 'officer', cls: 5, role: 'provider', username: 'ee.kjs', password: PASSWORD } });
  assert.equal(wrongCls.status, 400, 'a data officer is class 3');

  const p = await admin.as('POST', '/identity/v1/people', { body: { name: 'Executive Engineer', email: 'ee@kjs.demo-city.example', kind: 'officer', cls: 3, role: 'provider', username: 'ee.kjs', password: PASSWORD } });
  assert.equal(p.status, 201, JSON.stringify(p.body)); assert.equal(p.body.account.must_change, 1);

  const consumerTry = await (await c.login('planner')).as('POST', '/identity/v1/people', { body: {} });
  assert.equal(consumerTry.status, 403, 'only the administrator adds people');

  const first = await c.login('ee.kjs');
  assert.equal((await first.as('POST', '/auth/v1/password', { body: { old: PASSWORD, new: 'New-password-2027' } })).status, 200);
  const ee = await c.login('ee.kjs', 'New-password-2027');

  const noProv = await ee.as('POST', '/catalogue/v1/items/simple', { body: { type: 'group', name: 'Pumps', description: 'x', model: 'drainLevel', resourceServer: 'urn:demo-cat:rs/rs1' } });
  assert.equal(noProv.status, 400, 'a group needs the provider entry first');
  const prov = await ee.as('POST', '/catalogue/v1/items/simple', { body: { type: 'provider', name: 'Jal Sansthan (demo)', description: 'Water supply and pumping data' } });
  assert.equal(prov.status, 201, JSON.stringify(prov.body));
  const grp = await ee.as('POST', '/catalogue/v1/items/simple', { body: { type: 'group', name: 'Pumping station levels', description: 'Sump levels', tags: 'pump, water', model: 'drainLevel', resourceServer: 'urn:demo-cat:rs/rs1' } });
  assert.equal(grp.status, 201, JSON.stringify(grp.body));
  const ds = await ee.as('POST', '/catalogue/v1/items/simple', { body: { type: 'dataset', group: grp.body.id, name: 'Pump station 4', description: 'Sump level at station 4', tags: 'pump', label: 'public', lon: '80.33', lat: '26.45' } });
  assert.equal(ds.status, 201, JSON.stringify(ds.body)); assert.equal(ds.body.resourceServerGroup.value, grp.body.id);

  const mine = await ee.as('GET', '/catalogue/v1/mine');
  assert.deepEqual(mine.body.map(i => i.type).sort(), ['provider', 'resourceItem', 'resourceServerGroup']);

  const ing = await ee.as('POST', '/resource/v1/ingest', { body: { id: ds.body.id, data: [{ level: 1.2, flow: 3.4, capacity: 2.5, observationDateTime: '2026-10-01T10:00:00Z' }] } });
  assert.equal(ing.status, 200, JSON.stringify(ing.body));
  const read = await c.req('GET', '/resource/v1/latest?id=' + encodeURIComponent(ds.body.id));
  assert.equal(read.status, 200, JSON.stringify(read.body));

  const other = await (await c.login('officer.transport')).as('POST', '/catalogue/v1/items/simple', { body: { type: 'dataset', group: grp.body.id, name: 'Not mine', description: 'x' } });
  assert.equal(other.status, 403, 'another department cannot add to this group');
});
