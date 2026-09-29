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
// Table 4 labels expressed as Table 3 defaults
export const T4_TO_T3 = {
  public: { authProtocol: 'None', dataLocality: 'None', dataRetention: 'None', dataStorage: 'Any', dataUsage: 'Any', dataAudit: 'None' },
  protected: { authProtocol: 'OAuth/UMA', dataLocality: 'None', dataRetention: 'None', dataStorage: 'Any', dataUsage: 'Any', dataAudit: 'Audit accesses along with time and duration of access' },
  private: { authProtocol: 'OAuth/UMA + XACML Policy', dataLocality: 'Country', dataRetention: 'Fixed period', dataStorage: 'Encrypted (using adequately protected keys)', dataUsage: 'Anonymization', dataAudit: 'Audit accesses along with time and duration of access' },
  confidential: { authProtocol: 'Token/DX + Aperture policy language', dataLocality: 'Organization (Service-based access)', dataRetention: 'None', dataStorage: 'Encrypted (using keys owned by data owner)', dataUsage: 'Computation certified by a third party', dataAudit: 'Audit accesses along with time and duration of access' },
};

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
    if (v.type === 'QuantitativeProperty' && isNaN(Number(v.value))) errs.push(`"${k}" QuantitativeProperty value must be a number`);
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
    if (!T3[k]) errs.push(`A: "${k}" is not a Table 3 attribute`);
    else if (!T3[k].includes(v)) errs.push(`A: "${v}" is not an allowed value for ${k}`);
  }
  return errs;
}
