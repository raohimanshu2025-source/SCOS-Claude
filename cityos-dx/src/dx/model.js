// Catalogue information model and policy vocabulary, taken from BIS sections 5.4 and 6 (Tables 3-8).
export const CTX = ['<catalogue-link>/core_context.json', '<catalogue-link>/common_context.json'];
export const ITEM_TYPES = ['resourceItem', 'resourceServer', 'provider', 'resourceServerGroup', 'catalogueItem']; // Table 5
export const CORE = ['Property', 'Relationship', 'GeoProperty', 'QuantitativeProperty', 'TimeProperty']; // 6.2
export const RTYPES = ['file', 'table', 'message', 'messageStream', 'mediaStream']; // Table 8
export const LABELS = ['public', 'protected', 'private', 'confidential']; // 5.2, Table 4

// Table 7 mandatory attributes
export const MANDATORY = {
  provider: ['id', 'name', 'tags', 'refBaseSchema', 'itemDescription', 'itemType'],
  resourceItem: ['id', 'tags', 'refBaseSchema', 'resourceServer', 'itemDescription', 'refDataModel', 'provider', 'resourceServerGroup', 'resourceId', 'itemType'],
  resourceServer: ['id', 'name', 'tags', 'refBaseSchema', 'itemDescription', 'resourceServerHTTPAccessURL', 'resourceServerOrg', 'coverageRegion', 'itemType'],
  resourceServerGroup: ['id', 'name', 'tags', 'refBaseSchema', 'resourceServer', 'itemDescription', 'refDataModel', 'provider', 'itemType'],
  catalogueItem: ['id', 'name', 'tags', 'refBaseSchema', 'itemDescription', 'itemType'],
};

// 5.4.2 which certificate classes may reach which label
export const LABEL_CLASSES = { public: [], protected: [2, 4, 5], private: [4, 5], confidential: [5] };

// Table 3 attribute values
export const T3 = {
  authProtocol: ['None', 'OAuth/UMA', 'OAuth/UMA + XACML Policy', 'Token/DX + Aperture policy language'],
  dataLocality: ['Country', 'State', 'Organization (Service-based access)', 'None'],
  dataRetention: ['Fixed period', 'Up to a certain event or date', 'None'],
  dataStorage: ['Encrypted (using adequately protected keys)', 'Encrypted (using keys owned by data owner)', 'Any'],
  dataUsage: ['Privacy preserving computation', 'Anonymization', 'Computation certified by a third party', 'Any'],
  dataAudit: ['Audit accesses along with time and duration of access', 'None'],
};
// Table 3 attribute names as printed in the standard (the keys above are their API names)
export const T3_NAMES = { authProtocol: 'Authorization protocol and policy', dataLocality: 'Data locality', dataRetention: 'Data retention', dataStorage: 'Data storage', dataUsage: 'Data usage', dataAudit: 'Data audit' };
// Table 4 "Some standard policy Labels", cell by cell as printed (p. 24-25)
export const TABLE4_ROWS = { natureOfData: 'Nature of data', authProtocol: 'Authorization protocol and policy', consent: 'Consent', dataLocality: 'Data locality', dataRetention: 'Data retention', dataStorage: 'Data storage', dataUsage: 'Data usage', dataAudit: 'Data audit', dataMonetization: 'Data Monetization' };
export const TABLE4 = {
  public: { natureOfData: 'Information which can be made available to the public. It shall not contain any personally identifiable information', authProtocol: 'None', consent: 'None', dataLocality: 'None', dataRetention: 'None', dataStorage: 'Any', dataUsage: 'Any', dataAudit: 'None', dataMonetization: 'Not to be monetized' },
  protected: { natureOfData: 'Contains anonymized information', authProtocol: 'Requires authorization using DX/UMA, no custom auth policy', consent: 'Provider', dataLocality: 'None', dataRetention: 'None', dataStorage: 'Any', dataUsage: 'License', dataAudit: 'Random audit', dataMonetization: "Provider's decision" },
  private: { natureOfData: 'May contain personally identifiable information', authProtocol: 'Requires authorization using DX/UMA, custom auth policy specified in a policy language', consent: 'Requires consent of owners', dataLocality: 'Configurable or as per regulatory framework', dataRetention: 'Configurable or as per regulatory framework', dataStorage: 'Encrypted', dataUsage: 'Licensed with legal framework', dataAudit: 'Needs audit', dataMonetization: "Provider's decision" },
  confidential: { natureOfData: 'May contain personally identifiable information and/or other data that is confidential within the organization', authProtocol: 'Requires authorization using DX/UMA, custom auth policy specified in a policy language', consent: 'Requires consent of owners', dataLocality: 'Only service based access', dataRetention: 'NA', dataStorage: 'NA', dataUsage: 'Licensed with legal framework', dataAudit: 'Needs audit', dataMonetization: 'NA' },
};
// A new policy starts from its label's Table 4 column (every row except "Nature of data", which describes the data).
// The provider can then pick Table 3 values for the six Table 3 attributes (5.4: the list "is not exhaustive").
export const LABEL_DEFAULTS = Object.fromEntries(Object.entries(TABLE4).map(([l, row]) => [l, Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'natureOfData'))]));
const EXTRA_ATTRS = ['consent', 'dataMonetization'];

// Data models (6.4.2). Units follow UN/CEFACT common codes as in Annex 1 (X59 ppm, CEL degree Celsius).
export const MODELS = {
  airQuality: { describes: 'Environmental sensor measuring CO2, temperature and PM2.5', props: { CO2_MAX: ['QuantitativeProperty', 'X59', 'part per million (ppm)', 0, 5000], TEMPERATURE_MAX: ['QuantitativeProperty', 'CEL', 'degree Celsius', -20, 50], PM2_5: ['QuantitativeProperty', 'GQ', 'microgram per cubic metre', 0, 999], LASTUPDATEDATETIME: ['TimeProperty'], NAME: ['Property'] } },
  busPosition: { describes: 'Position of a bus on a route', props: { busId: ['Property'], routeId: ['Property'], location: ['GeoProperty'], speed: ['QuantitativeProperty', 'KMH', 'kilometre per hour', 0, 120], delayMinutes: ['QuantitativeProperty', 'MIN', 'minute', 0, 180], observationDateTime: ['TimeProperty'] } },
  busStops: { describes: 'Bus stops per route', props: { stopId: ['Property'], routeId: ['Property'], location: ['GeoProperty'], name: ['Property'] } },
  drainLevel: { describes: 'Storm water drain level and flow', props: { level: ['QuantitativeProperty', 'MTR', 'metre', 0, 5], flow: ['QuantitativeProperty', 'MQS', 'cubic metre per second', 0, 20], capacity: ['QuantitativeProperty', 'MTR', 'metre', 0, 5], observationDateTime: ['TimeProperty'] } },
  weather: { describes: 'Weather station', props: { airTemperature: ['QuantitativeProperty', 'CEL', 'degree Celsius', -20, 55], relativeHumidity: ['QuantitativeProperty', 'P1', 'percent', 0, 100], windSpeed: ['QuantitativeProperty', 'MTS', 'metre per second', 0, 60], windDirection: ['QuantitativeProperty', 'DD', 'degree', 0, 360], rainfall: ['QuantitativeProperty', 'MMT', 'millimetre', 0, 500], observationDateTime: ['TimeProperty'] } },
  wasteDaily: { describes: 'Daily waste collected per ward', props: { ward: ['Property'], date: ['TimeProperty'], tonnes: ['QuantitativeProperty', 'TNE', 'tonne', 0, 500] } },
  grievance: { describes: 'Citizen grievance record (contains PII)', props: { ref: ['Property'], ward: ['Property'], category: ['Property'], date: ['TimeProperty'], citizenName: ['Property'], phone: ['Property'] } },
  grievanceCount: { describes: 'Grievance counts by ward and category (a view without PII)', props: { ward: ['Property'], category: ['Property'], count: ['QuantitativeProperty', 'C62', 'one', 0, 10000] } },
  camera: { describes: 'Traffic camera video stream', props: { streamURL: ['Property'], location: ['GeoProperty'] } },
  wardBoundary: { describes: 'Ward boundaries as GeoJSON', props: { wardId: ['Property'], boundary: ['GeoProperty'] } },
  fareRevenue: { describes: 'Daily fare revenue and operating cost per mode', props: { mode: ['Property'], date: ['TimeProperty'], revenue: ['QuantitativeProperty', 'INR', 'Indian rupee', 0, 1e9], cost: ['QuantitativeProperty', 'INR', 'Indian rupee', 0, 1e9] } },
  floodAlert: { describes: 'Flood alert notification', props: { ward: ['Property'], severity: ['Property'], message: ['Property'], observationDateTime: ['TimeProperty'] } },
  // Figure 7 of the City OS paper (multimodal transit): metro and suburban rail timetables and vehicle occupancy.
  railTimetable: { describes: 'Metro or suburban rail line: stations in order with running time and service pattern', props: { line: ['Property'], mode: ['Property'], stationId: ['Property'], name: ['Property'], location: ['GeoProperty'], seq: ['QuantitativeProperty', 'C62', 'one', 1, 100], runMinutes: ['QuantitativeProperty', 'MIN', 'minute', 0, 300], firstTrain: ['Property'], lastTrain: ['Property'], headwayMinutes: ['QuantitativeProperty', 'MIN', 'minute', 1, 120] } },
  transitOccupancy: { describes: 'Share of seats and standing room in use on a bus route, metro or suburban rail line', props: { line: ['Property'], mode: ['Property'], occupancyPercent: ['QuantitativeProperty', 'P1', 'percent', 0, 200], observationDateTime: ['TimeProperty'] } },
  // Added for the Kanpur profile (not in the two documents): data models for more city departments, written the same way (BIS 6.4).
  powerFeeder: { describes: 'Electricity feeder status and load', props: { feederId: ['Property'], substation: ['Property'], zone: ['Property'], location: ['GeoProperty'], loadMW: ['QuantitativeProperty', 'MAW', 'megawatt', 0, 50], status: ['Property'], observationDateTime: ['TimeProperty'] } },
  pumpStation: { describes: 'Sewage or storm water pumping station status', props: { stationId: ['Property'], zone: ['Property'], location: ['GeoProperty'], pumpsRunning: ['QuantitativeProperty', 'C62', 'one', 0, 20], pumpsTotal: ['QuantitativeProperty', 'C62', 'one', 0, 20], sumpLevel: ['QuantitativeProperty', 'MTR', 'metre', 0, 10], powerStatus: ['Property'], observationDateTime: ['TimeProperty'] } },
  waterSupply: { describes: 'Daily drinking water supply per zone', props: { zone: ['Property'], date: ['TimeProperty'], supplyHours: ['QuantitativeProperty', 'HUR', 'hour', 0, 24], pressure: ['QuantitativeProperty', 'BAR', 'bar', 0, 10] } },
  trafficJunction: { describes: 'Traffic count and speed at a junction', props: { junctionId: ['Property'], name: ['Property'], location: ['GeoProperty'], vehicleCount: ['QuantitativeProperty', 'C62', 'one', 0, 5000], avgSpeed: ['QuantitativeProperty', 'KMH', 'kilometre per hour', 0, 120], observationDateTime: ['TimeProperty'] } },
  fireCall: { describes: 'Fire and rescue call record', props: { callId: ['Property'], zone: ['Property'], type: ['Property'], location: ['GeoProperty'], reportedAt: ['TimeProperty'], status: ['Property'], responseMinutes: ['QuantitativeProperty', 'MIN', 'minute', 0, 600] } },
  hospitalBeds: { describes: 'Hospital bed availability', props: { hospitalId: ['Property'], name: ['Property'], location: ['GeoProperty'], bedsTotal: ['QuantitativeProperty', 'C62', 'one', 0, 5000], bedsFree: ['QuantitativeProperty', 'C62', 'one', 0, 5000], icuFree: ['QuantitativeProperty', 'C62', 'one', 0, 500], observationDateTime: ['TimeProperty'] } },
  buildingPermit: { describes: 'Building permission application', props: { permitId: ['Property'], zone: ['Property'], use: ['Property'], floors: ['QuantitativeProperty', 'C62', 'one', 0, 100], status: ['Property'], date: ['TimeProperty'] } },
  pastIncident: { describes: 'Past city incident summarised from public news reports', props: { incidentId: ['Property'], type: ['Property'], date: ['TimeProperty'], place: ['Property'], area: ['Property'], summary: ['Property'], trigger: ['Property'], chain: ['Property'], systems: ['Property'], departments: ['Property'], impact: ['Property'], sources: ['Property'], sourceUrl: ['Property'], publisher: ['Property'], evidence: ['Property'], location: ['GeoProperty'] } },
  powerNotice: { describes: 'Power cut notice for an area', props: { noticeId: ['Property'], area: ['Property'], zone: ['Property'], type: ['Property'], from: ['TimeProperty'], to: ['TimeProperty'], reason: ['Property'], status: ['Property'] } },
  roadWork: { describes: 'Road work and lane closure', props: { workId: ['Property'], road: ['Property'], zone: ['Property'], status: ['Property'], lanesClosed: ['QuantitativeProperty', 'C62', 'one', 0, 10], startDate: ['TimeProperty'], endDate: ['Property'] } },
};

export function dataModelDoc(name) {
  const m = MODELS[name]; if (!m) return null;
  const properties = {};
  for (const [k, [t, uc, ut, mn, mx]] of Object.entries(m.props)) {
    const p = { $ref: `<catalogue-link>/core_defs.json#/definitions/${t}` };
    if (uc) Object.assign(p, { unitCode: uc, unitText: ut, minValue: mn, maxValue: mx });
    properties[k] = p;
  }
  return { $schema: 'http://json-schema.org/draft-07/schema#', '@context': [...CTX, `<catalogue-link>/${name}/${name}_context.json`], describes: m.describes, type: 'object', properties };
}
export const modelOfRef = ref => (String(ref || '').match(/<catalogue-link>\/(\w+)\/\1_dataModel\.json$/) || [])[1] || null;

// Checks one data packet against its data model (6.4.2, 6.4.2.1 compact key-value form).
export function validatePacket(modelName, pkt) {
  const m = MODELS[modelName]; const errs = [];
  if (!m) return ['unknown data model ' + modelName];
  if (!pkt || typeof pkt !== 'object' || Array.isArray(pkt)) return ['packet must be a JSON object'];
  for (const [k, v] of Object.entries(pkt)) {
    if (k === '@context') continue;
    const d = m.props[k];
    if (!d) { errs.push(`"${k}" is not in data model ${modelName}`); continue; }
    const [t, , , mn, mx] = d;
    if (t === 'QuantitativeProperty') {
      if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`"${k}" must be a number`);
      else if (v < mn || v > mx) errs.push(`"${k}"=${v} is outside ${mn}..${mx}`);
    }
    if (t === 'TimeProperty' && !(W3C_DT.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v))) errs.push(`"${k}" is not a W3C date-time`);
    if (t === 'GeoProperty' && !(v && typeof v === 'object' && v.type && v.coordinates)) errs.push(`"${k}" must be GeoJSON geometry`);
  }
  return errs;
}

export const W3C_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

// Section 6.1-6.4 and Tables 6-8 checks on one catalogue item. `exists(id)` resolves references.
export function validateItem(it, exists = () => true) {
  const errs = [];
  if (!it || typeof it !== 'object' || Array.isArray(it)) return ['item must be a JSON object'];
  const t = it.itemType?.value;
  if (!it['@context']) errs.push('@context is missing (6.1.1: every item is a JSON-LD document)');
  if (typeof it.id !== 'string' || !/^urn:[a-z0-9][a-z0-9-]{0,31}:[\w\-.:/]+$/i.test(it.id)) errs.push('id must be a URN (e.g. urn:demo-cat:group/key)');
  if (!MANDATORY[t]) errs.push(`itemType "${t}" is not one of Table 5`);
  else for (const m of MANDATORY[t]) if (!(m in it)) errs.push(`mandatory attribute "${m}" missing (Table 7)`);
  for (const [k, v] of Object.entries(it)) {
    if (k === '@context' || k === 'id' || k === 'accessInformation') continue;
    if (k.startsWith('_')) { errs.push(`"${k}": attribute names may not start with _`); continue; }
    if (!v || typeof v !== 'object' || !('type' in v)) { errs.push(`"${k}" has no core attribute type`); continue; }
    if (!CORE.includes(v.type)) { errs.push(`"${k}" type "${v.type}" is not a core attribute type (6.2)`); continue; }
    if (!('value' in v)) errs.push(`"${k}" has no "value" (mandatory fields: type, value)`);
    if (v.type === 'Relationship' && !(typeof v.value === 'string' || Array.isArray(v.value))) errs.push(`"${k}" Relationship value must be a URI string`);
    if (v.type === 'TimeProperty' && !W3C_DT.test(v.value)) errs.push(`"${k}" is not a W3C date-time`);
    if (v.type === 'GeoProperty' && !(v.value?.geometry?.type || typeof v.value?.address === 'string')) errs.push(`"${k}" GeoProperty needs geometry or address`);
    if (k === 'location' && v.value?.geometry?.type !== 'Point') errs.push('"location" must be a GeoJSON Point (Table 6)');
    if (k === 'coverageRegion' && v.value?.geometry?.type !== 'Polygon') errs.push('"coverageRegion" must be a GeoJSON Polygon (Table 6)');
    // 6.2: "number or array of numbers"; "A numeric quantity represented as a string is acceptable"
    if (v.type === 'QuantitativeProperty' && !(Array.isArray(v.value) ? v.value : [v.value]).every(x => typeof x === 'number' ? Number.isFinite(x) : typeof x === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(x))) errs.push(`"${k}" QuantitativeProperty value must be a number, a numeric string or an array of them`);
  }
  if (t === 'resourceItem') {
    if (!LABELS.includes(it.accessPolicyLabel?.value)) errs.push('item must be tagged public, protected, private or confidential (5.2)');
    if (!RTYPES.includes(it.resourceType?.value)) errs.push('resourceType must be one of Table 8');
  }
  for (const ref of ['provider', 'resourceServer', 'resourceServerGroup']) {
    if (it[ref] && typeof it[ref].value === 'string' && !exists(it[ref].value)) errs.push(`${ref} reference ${it[ref].value} does not resolve (6.4.4)`);
  }
  if (it.refDataModel && t !== 'provider' && !modelOfRef(it.refDataModel.value)) errs.push('refDataModel must point to a data model known to this catalogue (6.4.2)');
  return errs;
}

export function checkPolicy(policy) {
  const errs = [];
  if (!policy || typeof policy !== 'object') return ['policy must be an object'];
  if (!LABELS.includes(policy.label)) errs.push('policy label must be public, protected, private or confidential');
  if (!Array.isArray(policy.C) || policy.C.some(c => typeof c !== 'string')) errs.push('C must be a list of consumer ids (e-mail addresses)');
  for (const [k, v] of Object.entries(policy.A || {})) {
    const t4 = TABLE4[policy.label]?.[k];
    if (!T3[k] && !EXTRA_ATTRS.includes(k)) errs.push(`A: "${k}" is not a Table 3 attribute or a Table 4 row`);
    else if (v !== t4 && !(T3[k] || []).includes(v)) errs.push(`A: "${v}" is not an allowed value for ${k}: use a Table 3 value or the Table 4 value "${t4}"`);
  }
  return errs;
}

// 6.1.1 / 6.4: the JSON-LD contexts and base schemas the DX provides. They are served by the catalogue
// (/catalogue/v1/context, /catalogue/v1/schemas) and are not catalogue items themselves.
export function contextDoc(name) {
  if (name === 'core') return { '@context': { dx: 'https://dx.demo-city.example/vocab#', ...Object.fromEntries(CORE.map(t => [t, 'dx:' + t])), type: '@type', value: 'dx:value', unitCode: 'https://schema.org/unitCode', unitText: 'https://schema.org/unitText', minValue: 'https://schema.org/minValue', maxValue: 'https://schema.org/maxValue' } };
  if (name === 'common') { const attrs = [...new Set(Object.values(MANDATORY).flat().concat(['location', 'coverageRegion', 'createdAt', 'modifiedAt', 'itemStatus', 'accessPolicyLabel', 'resourceType', 'accessObject', 'organizationInfo']))].filter(a => a !== 'id' && a !== 'itemType'); return { '@context': { dx: 'https://dx.demo-city.example/vocab#', ...Object.fromEntries(attrs.map(a => [a, 'dx:' + a])), itemType: '@type' } }; }
  return null;
}
export function baseSchema(type) {
  if (!MANDATORY[type]) return null;
  return { $schema: 'http://json-schema.org/draft-07/schema#', $id: `<catalogue-link>/${type}_schema.json`, title: `DX base schema for ${type} (Table 7 mandatory attributes)`, type: 'object',
    required: ['@context', ...MANDATORY[type]], properties: Object.fromEntries(MANDATORY[type].filter(a => a !== 'id').map(a => [a, { type: 'object', required: ['type', 'value'], properties: { type: { enum: CORE } } }])) };
}
