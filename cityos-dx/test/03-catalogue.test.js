// Catalogue: information model, Discover and Manage interfaces (BIS 4.3, 4.5.1, 5.3, 6, Tables 5-8, Annex 1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCity } from './helpers.js';

let c;
before(async () => { c = await startCity(); });
after(async () => { await c.stop(); });

const newItem = (id, extra = {}) => ({
  '@context': ['<catalogue-link>/core_context.json'], id,
  itemType: { type: 'Property', value: 'resourceItem' }, name: { type: 'Property', value: 'Noise sensor 1' },
  itemDescription: { type: 'Property', value: 'Test sensor' }, tags: { type: 'Property', value: ['noise', 'test'] },
  refBaseSchema: { type: 'Relationship', value: '<catalogue-link>/resourceItem_schema.json' },
  resourceServer: { type: 'Relationship', value: 'urn:demo-cat:rs/rs1' }, resourceServerGroup: { type: 'Relationship', value: 'urn:demo-cat:group/aqm' },
  provider: { type: 'Relationship', value: 'urn:demo-cat:provider/pcc' }, refDataModel: { type: 'Relationship', value: '<catalogue-link>/airQuality/airQuality_dataModel.json' },
  resourceId: { type: 'Property', value: 'aqm-99' }, resourceType: { type: 'Property', value: 'messageStream' }, accessPolicyLabel: { type: 'Property', value: 'public' },
  location: { type: 'GeoProperty', value: { geometry: { type: 'Point', coordinates: [80.05, 20.05] } } }, ...extra,
});

test('[BIS-34][BIS-42][BIS-98][BIS-27] text, attribute, geo (bbox and near), time search and count', async () => {
  const text = await c.req('GET', '/catalogue/v1/search?q=drain');
  assert.ok(text.body.total >= 5);
  const attr = await c.req('GET', '/catalogue/v1/search?attr=tags&value=flood');
  assert.ok(attr.body.results.every(i => i.tags.value.includes('flood')));
  const bbox = await c.req('GET', '/catalogue/v1/search?bbox=80.0,20.0,80.034,20.034&type=resourceItem');
  assert.ok(bbox.body.results.length >= 1 && bbox.body.results.every(i => { const [x, y] = i.location?.value.geometry.coordinates ?? [0, 0]; return x <= 80.034 && y <= 20.034; }));
  const near = await c.req('GET', '/catalogue/v1/search?near=80.05,20.05,1');
  assert.ok(near.body.total >= 1);
  const time = await c.req('GET', `/catalogue/v1/search?time=${new Date(Date.now() - 3600e3).toISOString()}&timerel=after`);
  assert.ok(time.body.total > 40);
  const cnt = await c.req('GET', '/catalogue/v1/count?type=resourceItem');
  assert.equal(cnt.body.count, 35);
  assert.equal((await c.req('GET', '/catalogue/v1/search?bbox=1,2')).status, 400);
});

test('[BIS-84][BIS-86][BIS-85][BIS-88][BIS-44][BIS-46][BIS-93] every stored item is JSON-LD with core types and resolving references', async () => {
  const all = await c.req('GET', '/catalogue/v1/search?limit=500');
  assert.equal(all.body.total, 58);
  const { validateItem } = await import('../src/dx/model.js');
  const ids = new Set(all.body.results.map(i => i.id));
  for (const it of all.body.results) assert.deepEqual(validateItem(it, id => ids.has(id)), [], it.id);
  const ri = all.body.results.find(i => i.id === 'urn:demo-cat:aqm/aqm-1');
  assert.equal(ri.provider.type, 'Relationship'); assert.equal(ri.location.value.geometry.type, 'Point');
  assert.ok(ids.has(ri.resourceServerGroup.value));
});

test('[BIS-43][BIS-90][BIS-101][BIS-45][BIS-92] data models with units and ranges; access information on items', async () => {
  const dm = await c.req('GET', '/catalogue/v1/datamodels?name=airQuality');
  assert.equal(dm.body.properties.CO2_MAX.unitCode, 'X59');
  assert.equal(dm.body.properties.TEMPERATURE_MAX.unitCode, 'CEL');
  assert.ok(dm.body['@context'].length >= 3);
  const it = await c.req('GET', '/catalogue/v1/items?id=urn:demo-cat:itms/bus-101');
  assert.equal(it.body.accessInformation.value[0].accessObjectType, 'asyncAPI');
});

test('[BIS-67][BIS-33][BIS-97][BIS-17][BIS-52] only a class 3 data officer of the owning organisation can create, update or delete', async () => {
  const anon = await c.req('POST', '/catalogue/v1/items', { body: { item: newItem('urn:demo-cat:aqm/aqm-99') } });
  assert.equal(anon.status, 403);
  const cls5 = await c.req('POST', '/catalogue/v1/items', { as: 'control@mc.demo-city.example', body: { item: newItem('urn:demo-cat:aqm/aqm-99') } });
  assert.equal(cls5.status, 403, 'class 5 is for data access, not catalogue management');
  const otherOrg = await c.req('POST', '/catalogue/v1/items', { as: 'officer@wd.demo-city.example', body: { item: newItem('urn:demo-cat:aqm/aqm-99') } });
  assert.equal(otherOrg.status, 403);
  const ok = await c.req('POST', '/catalogue/v1/items', { as: 'officer@pcc.demo-city.example', body: { item: newItem('urn:demo-cat:aqm/aqm-99') } });
  assert.equal(ok.status, 201, "Figure 7: 201 Created" + JSON.stringify(ok.body));
  assert.ok(ok.body.createdAt.value);
  const upd = await c.req('PUT', '/catalogue/v1/items?id=urn:demo-cat:aqm/aqm-99', { as: 'officer@pcc.demo-city.example', body: { item: newItem('urn:demo-cat:aqm/aqm-99', { name: { type: 'Property', value: 'Noise sensor one' } }) } });
  assert.equal(upd.body.name.value, 'Noise sensor one'); assert.ok(upd.body.modifiedAt);
  const updOther = await c.req('PUT', '/catalogue/v1/items?id=urn:demo-cat:aqm/aqm-99', { as: 'officer@mc.demo-city.example', body: { item: newItem('urn:demo-cat:aqm/aqm-99') } });
  assert.equal(updOther.status, 403);
  const del = await c.req('DELETE', '/catalogue/v1/items?id=urn:demo-cat:aqm/aqm-99', { as: 'officer@pcc.demo-city.example' });
  assert.equal(del.status, 200);
  assert.equal((await c.req('GET', '/catalogue/v1/items?id=urn:demo-cat:aqm/aqm-99')).status, 404);
});

test('[BIS-61][BIS-87][BIS-89][BIS-94] items failing the model are refused with reasons', async () => {
  const bad = newItem('urn:demo-cat:aqm/aqm-98', { accessPolicyLabel: { type: 'Property', value: 'secret' }, resourceType: { type: 'Property', value: 'video' }, location: { type: 'GeoProperty', value: { geometry: { type: 'Polygon', coordinates: [] } } }, createdBy: { type: 'Text', value: 'x' } });
  delete bad.resourceId; delete bad['@context'];
  const r = await c.req('POST', '/catalogue/v1/items', { as: 'officer@pcc.demo-city.example', body: { item: bad } });
  assert.equal(r.status, 400);
  const e = r.body.errors.join(' | ');
  for (const m of ['@context is missing', 'mandatory attribute "resourceId"', 'tagged public, protected, private or confidential', 'resourceType must be one of Table 8', 'must be a GeoJSON Point', 'not a core attribute type']) assert.ok(e.includes(m), m);
  const dangling = await c.req('POST', '/catalogue/v1/items', { as: 'officer@pcc.demo-city.example', body: { item: newItem('urn:demo-cat:aqm/aqm-97', { resourceServer: { type: 'Relationship', value: 'urn:demo-cat:rs/nowhere' } }) } });
  assert.match(dangling.body.errors.join(), /does not resolve \(6\.4\.4\)/);
});

test('[BIS-93] an item that others refer to cannot be deleted', async () => {
  const r = await c.req('DELETE', '/catalogue/v1/items?id=urn:demo-cat:group/aqm', { as: 'officer@pcc.demo-city.example' });
  assert.equal(r.status, 409);
});

test('[BIS-29] an app registered for changes is notified when an item changes', async () => {
  await c.req('POST', '/catalogue/v1/watch', { as: 'dev@apps.example', body: { id: 'urn:demo-cat:fare/fare-revenue' } });
  await c.req('PUT', '/auth/v1/acl?id=urn:demo-cat:fare/fare-revenue', { as: 'officer@transport.demo-city.example', body: { label: 'private' } });
  const inbox = await c.req('GET', '/notify/v1/inbox', { as: 'dev@apps.example' });
  assert.ok(inbox.body.notices.some(n => n.msg.includes('fare-revenue') && n.msg.includes('private')));
});

test('[BIS-82] the consumer can ask the catalogue service for its status', async () => {
  const s = await c.req('GET', '/catalogue/v1/status');
  assert.equal(s.body.status, 'up');
});
