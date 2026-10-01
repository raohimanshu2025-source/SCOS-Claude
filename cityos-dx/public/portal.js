// Public city data portal. Reads only what anyone may read (public items, public analytics, status) from the
// server's own APIs, without a login, and draws tiles, a map and dashboards. Refreshes every minute.
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } } };
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : '–');
const last = a => a[a.length - 1];

// ---------- language ----------
const T = {
  en: {
    skip: 'Skip to main content', demoTag: 'DEMO', stripMsg: 'Independent research prototype with synthetic demo data. Not an official government website and not a live city system.',
    contrast: 'High contrast', portalName: 'City Data Portal', portalSub: 'Shared city data and live dashboards for departments and citizens', officerLogin: 'Officer login',
    navHome: 'City today', navMap: 'Map', navDash: 'Dashboards', navDepts: 'Departments', navData: 'Open data', navStatus: 'Service status', navAbout: 'About',
    heroTitle: "One place for the city's data", heroLead: 'Departments publish their data once on a shared data exchange. Citizens see the public parts here. Officers log in to share protected data with other departments, with consent and a full audit trail.',
    updated: 'Updated', liveNow: 'Live city data', ctaDash: 'See live dashboards', ctaData: 'Browse open data', refreshNote: 'Refreshes every minute.', glanceTitle: 'The city today', mapTitle: 'City map', mapNote: 'Zones are a synthetic grid and all points are approximate demo locations.',
    dashTitle: 'Live dashboards', deptTitle: 'Departments on the data exchange', deptNote: 'Each department publishes its own data and decides who may see it. Names are used for demonstration only; no department has supplied or approved this data.',
    dataTitle: 'Open data catalogue', search: 'Search', department: 'Department', access: 'Access', statusTitle: 'Service status', aboutTitle: 'About this portal',
    about1: 'This portal shows how a City Operating System could work: a data exchange where departments publish data with access rules, and a city intelligence layer that turns the data into dashboards and alerts.',
    about2: 'It follows two public documents: the BIS draft "Unified Digital Infrastructure – ICT Reference Architecture, Part 1: Data Exchange" (2019) and the paper "City Operating System and City Intelligence Layer" (v1.1, 2023). Parts that the documents do not ask for are listed in the project\'s conformance notes.',
    about3: 'All data here is synthetic. Department names are used only to show how the system would be organised. This is not an official website of any government body, and nothing here should be used for real decisions.',
    howTitle: 'How officials use it', how1: 'Open this page: anyone sees the public dashboards and open data.', how2: "Click Officer login. A department's data officer publishes datasets and sets who may see them.",
    how3: 'Staff of another department search the catalogue and ask for access. The owner approves or refuses, and every step is written to the audit log.', how4: 'The control room login sees all analytics and alerts across departments.',
    foot1: 'Independent research prototype. Synthetic demo data. Not affiliated with or endorsed by any government department.', apiStatus: 'Status API', apiList: 'API list',
    // dynamic
    aq: 'Air quality (PM2.5)', temp: 'Temperature', rain: 'Rain, last reading', water: 'Water supply', beds: 'Hospital beds free', traffic: 'Traffic speed', buses: 'City buses on time',
    roadworks: 'Road works', flood: 'Flood alerts', datasets: 'Datasets', avgOf: 'average of {n} stations', maxOf: 'highest of {n} stations', hDay: 'hours/day', cityAvg: 'city average', tapHint: 'Tap or hover a point for details.', lowest: 'lowest', icuFree: 'ICU beds free',
    junctionAvg: 'average at {n} junctions', slowest: 'slowest', inProgress: 'in progress', lanesClosed: 'lanes closed', none: 'None active', active: 'active', publicOf: 'public, of {n} in total',
    depts: 'departments', humidity: 'humidity', source: 'Source', noAlerts: 'No active alerts', alertsNow: 'Active alerts',
    band: ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very poor', 'Severe'], bandNote: 'Band uses CPCB AQI breakpoints for PM2.5; indicative only (demo readings).',
    lAq: 'Air quality', lTraffic: 'Traffic', lBeds: 'Hospitals', lBus: 'Buses', lWx: 'Weather', river: 'Ganga (approximate line)',
    pAq: 'Air quality by station', pAqTrend: 'City average PM2.5, last 24 hours', pWx: 'Weather stations', pWater: 'Water supply by zone', pWaterTrend: 'City average supply hours, last 14 days',
    pBeds: 'Hospital beds', pTraffic: 'Traffic at main junctions', pBus: 'City bus service', pRoad: 'Road works and lane closures', pPermit: 'Building permissions', pFlood: 'Flood alerts',
    station: 'Station', rainMm: 'Rain mm', humid: 'Humidity', wind: 'Wind', zone: 'Zone', hrs: 'h', bar: 'bar', free: 'free', of: 'of', occupied: 'occupied', vehicles: 'vehicles/15 min', kmh: 'km/h',
    bus: 'Bus', busesN: 'buses', route: 'Route', onTime: 'On time', delay: 'Delay', status: 'Status', road: 'Road', from: 'From', to: 'to', lanes: 'Lanes closed', byZone: 'Applications by zone',
    dataset: 'Dataset', model: 'Data type', get: 'Get data', all: 'All', loginToAsk: 'Officers ask for access after login', download: 'JSON', items: 'datasets', publicN: 'public',
    viewData: 'See its datasets', up: 'Up', down: 'Down', uptime: 'uptime, last 24 h', by: 'Data from', noData: 'No data yet.', latestN: 'latest {n}', rowsTotal: 'rows in total', minutes: 'min',
    accessName: { public: 'Public', protected: 'Protected', private: 'Private', confidential: 'Confidential' },
    accessHelp: { public: 'Anyone can open it', protected: 'Departments named in the policy, or after the owner approves a request', private: 'Only departments the owner names', confidential: 'Owner and control room only' },
  },
  hi: {
    skip: 'मुख्य सामग्री पर जाएँ', demoTag: 'डेमो', stripMsg: 'स्वतंत्र शोध प्रोटोटाइप, कृत्रिम (डेमो) डेटा के साथ। यह कोई आधिकारिक सरकारी वेबसाइट नहीं है और न ही लाइव शहर प्रणाली।',
    contrast: 'उच्च कंट्रास्ट', portalName: 'सिटी डेटा पोर्टल', portalSub: 'विभागों और नागरिकों के लिए साझा शहर डेटा और लाइव डैशबोर्ड', officerLogin: 'अधिकारी लॉगिन',
    navHome: 'आज का शहर', navMap: 'नक्शा', navDash: 'डैशबोर्ड', navDepts: 'विभाग', navData: 'खुला डेटा', navStatus: 'सेवा स्थिति', navAbout: 'परिचय',
    heroTitle: 'शहर के डेटा के लिए एक जगह', heroLead: 'विभाग अपना डेटा एक साझा डेटा एक्सचेंज पर एक बार प्रकाशित करते हैं। नागरिक यहाँ सार्वजनिक भाग देखते हैं। अधिकारी लॉगिन करके सहमति और पूरे ऑडिट रिकॉर्ड के साथ संरक्षित डेटा दूसरे विभागों से साझा करते हैं।',
    updated: 'अद्यतन', liveNow: 'लाइव शहर डेटा', ctaDash: 'लाइव डैशबोर्ड देखें', ctaData: 'खुला डेटा देखें', refreshNote: 'हर मिनट अपने आप अद्यतन होता है।', glanceTitle: 'आज का शहर', mapTitle: 'शहर का नक्शा', mapNote: 'ज़ोन एक कृत्रिम ग्रिड हैं और सभी स्थान अनुमानित डेमो स्थान हैं।',
    dashTitle: 'लाइव डैशबोर्ड', deptTitle: 'डेटा एक्सचेंज पर विभाग', deptNote: 'हर विभाग अपना डेटा खुद प्रकाशित करता है और तय करता है कि कौन देख सकता है। नाम केवल प्रदर्शन के लिए हैं; किसी विभाग ने यह डेटा नहीं दिया है और न ही स्वीकृत किया है।',
    dataTitle: 'खुला डेटा सूची', search: 'खोजें', department: 'विभाग', access: 'पहुँच', statusTitle: 'सेवा स्थिति', aboutTitle: 'इस पोर्टल के बारे में',
    about1: 'यह पोर्टल दिखाता है कि सिटी ऑपरेटिंग सिस्टम कैसे काम कर सकता है: एक डेटा एक्सचेंज जहाँ विभाग पहुँच नियमों के साथ डेटा प्रकाशित करते हैं, और एक सिटी इंटेलिजेंस लेयर जो डेटा को डैशबोर्ड और अलर्ट में बदलती है।',
    about2: 'यह दो सार्वजनिक दस्तावेज़ों पर आधारित है: BIS मसौदा "यूनिफाइड डिजिटल इन्फ्रास्ट्रक्चर – ICT रेफरेंस आर्किटेक्चर, भाग 1: डेटा एक्सचेंज" (2019) और "सिटी ऑपरेटिंग सिस्टम एंड सिटी इंटेलिजेंस लेयर" (v1.1, 2023)। दस्तावेज़ों से बाहर जोड़े गए हिस्से परियोजना के अनुरूपता नोट्स में सूचीबद्ध हैं।',
    about3: 'यहाँ का सारा डेटा कृत्रिम है। विभागों के नाम केवल यह दिखाने के लिए हैं कि प्रणाली कैसे व्यवस्थित होगी। यह किसी सरकारी संस्था की आधिकारिक वेबसाइट नहीं है, और यहाँ की किसी जानकारी का उपयोग वास्तविक निर्णयों के लिए न करें।',
    howTitle: 'अधिकारी इसका उपयोग कैसे करते हैं', how1: 'यह पेज खोलें: कोई भी सार्वजनिक डैशबोर्ड और खुला डेटा देख सकता है।', how2: 'अधिकारी लॉगिन पर क्लिक करें। विभाग का डेटा अधिकारी डेटासेट प्रकाशित करता है और तय करता है कि कौन देखे।',
    how3: 'दूसरे विभाग के कर्मचारी सूची में खोजते हैं और पहुँच माँगते हैं। मालिक विभाग स्वीकृत या अस्वीकार करता है, और हर कदम ऑडिट लॉग में दर्ज होता है।', how4: 'कंट्रोल रूम लॉगिन सभी विभागों के विश्लेषण और अलर्ट देखता है।',
    foot1: 'स्वतंत्र शोध प्रोटोटाइप। कृत्रिम डेमो डेटा। किसी सरकारी विभाग से संबद्ध या समर्थित नहीं।', apiStatus: 'स्थिति API', apiList: 'API सूची',
    aq: 'वायु गुणवत्ता (PM2.5)', temp: 'तापमान', rain: 'वर्षा, अंतिम माप', water: 'जल आपूर्ति', beds: 'अस्पताल में खाली बिस्तर', traffic: 'यातायात गति', buses: 'सिटी बसें समय पर',
    roadworks: 'सड़क कार्य', flood: 'बाढ़ अलर्ट', datasets: 'डेटासेट', avgOf: '{n} स्टेशनों का औसत', maxOf: '{n} स्टेशनों में सबसे अधिक', hDay: 'घंटे/दिन', cityAvg: 'शहर औसत', tapHint: 'विवरण के लिए किसी बिंदु पर टैप करें या माउस रखें।', lowest: 'सबसे कम', icuFree: 'ICU बिस्तर खाली',
    junctionAvg: '{n} चौराहों का औसत', slowest: 'सबसे धीमा', inProgress: 'जारी', lanesClosed: 'लेन बंद', none: 'कोई सक्रिय नहीं', active: 'सक्रिय', publicOf: 'सार्वजनिक, कुल {n} में से',
    depts: 'विभाग', humidity: 'आर्द्रता', source: 'स्रोत', noAlerts: 'कोई सक्रिय अलर्ट नहीं', alertsNow: 'सक्रिय अलर्ट',
    band: ['अच्छा', 'संतोषजनक', 'मध्यम', 'खराब', 'बहुत खराब', 'गंभीर'], bandNote: 'श्रेणी PM2.5 के लिए CPCB AQI सीमाओं पर आधारित है; केवल संकेतात्मक (डेमो माप)।',
    lAq: 'वायु गुणवत्ता', lTraffic: 'यातायात', lBeds: 'अस्पताल', lBus: 'बसें', lWx: 'मौसम', river: 'गंगा (अनुमानित रेखा)',
    pAq: 'स्टेशन अनुसार वायु गुणवत्ता', pAqTrend: 'शहर औसत PM2.5, पिछले 24 घंटे', pWx: 'मौसम स्टेशन', pWater: 'ज़ोन अनुसार जल आपूर्ति', pWaterTrend: 'शहर औसत आपूर्ति घंटे, पिछले 14 दिन',
    pBeds: 'अस्पताल बिस्तर', pTraffic: 'मुख्य चौराहों पर यातायात', pBus: 'सिटी बस सेवा', pRoad: 'सड़क कार्य और लेन बंदी', pPermit: 'भवन अनुमतियाँ', pFlood: 'बाढ़ अलर्ट',
    station: 'स्टेशन', rainMm: 'वर्षा मिमी', humid: 'आर्द्रता', wind: 'हवा', zone: 'ज़ोन', hrs: 'घं', bar: 'बार', free: 'खाली', of: 'में से', occupied: 'भरे', vehicles: 'वाहन/15 मिनट', kmh: 'किमी/घं',
    bus: 'बस', busesN: 'बसें', route: 'रूट', onTime: 'समय पर', delay: 'देरी', status: 'स्थिति', road: 'सड़क', from: 'से', to: 'तक', lanes: 'बंद लेन', byZone: 'ज़ोन अनुसार आवेदन',
    dataset: 'डेटासेट', model: 'डेटा प्रकार', get: 'डेटा लें', all: 'सभी', loginToAsk: 'अधिकारी लॉगिन के बाद पहुँच माँगते हैं', download: 'JSON', items: 'डेटासेट', publicN: 'सार्वजनिक',
    viewData: 'इसके डेटासेट देखें', up: 'चालू', down: 'बंद', uptime: 'उपलब्धता, पिछले 24 घंटे', by: 'डेटा स्रोत', noData: 'अभी कोई डेटा नहीं।', latestN: 'नवीनतम {n}', rowsTotal: 'कुल पंक्तियाँ', minutes: 'मिनट',
    accessName: { public: 'सार्वजनिक', protected: 'संरक्षित', private: 'निजी', confidential: 'गोपनीय' },
    accessHelp: { public: 'कोई भी खोल सकता है', protected: 'नीति में नामित विभाग, या मालिक की स्वीकृति के बाद', private: 'केवल मालिक द्वारा नामित विभाग', confidential: 'केवल मालिक और कंट्रोल रूम' },
  },
};
// What each Kanpur demo department would publish (shown on its card).
const ROLE = {
  en: { knn: 'Municipal services: solid waste, citizen grievances, zone boundaries.', kjs: 'Water supply, storm water drains and pumping stations.', kesco: 'Electricity feeders and substations.', traffic: 'Junction traffic counts and traffic cameras.',
    fire: 'Fire and rescue calls and response times.', cmo: 'Hospital beds and ICU availability.', kda: 'Building permission applications.', pwd: 'Road works and lane closures.', uppcb: 'Air quality monitoring.',
    kctsl: 'City bus positions, stops and fares.', iccc: 'Weather stations, flood alerts and the city control room.' },
  hi: { knn: 'नगर सेवाएँ: ठोस कचरा, नागरिक शिकायतें, ज़ोन सीमाएँ।', kjs: 'जल आपूर्ति, बरसाती नाले और पंपिंग स्टेशन।', kesco: 'बिजली फीडर और सबस्टेशन।', traffic: 'चौराहों पर वाहन गणना और ट्रैफ़िक कैमरे।',
    fire: 'आग और बचाव कॉल तथा प्रतिक्रिया समय।', cmo: 'अस्पताल बिस्तर और ICU उपलब्धता।', kda: 'भवन अनुमति आवेदन।', pwd: 'सड़क कार्य और लेन बंदी।', uppcb: 'वायु गुणवत्ता निगरानी।',
    kctsl: 'सिटी बसों की स्थिति, स्टॉप और किराया।', iccc: 'मौसम स्टेशन, बाढ़ अलर्ट और शहर कंट्रोल रूम।' },
};
let LANG = store.get('portal-lang') === 'hi' ? 'hi' : 'en';
const t = (k, vars) => { let s = T[LANG][k] ?? T.en[k] ?? k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b); return s; };
function applyLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  const b = $('#lang'); b.textContent = LANG === 'en' ? 'हिंदी' : 'English'; b.lang = LANG === 'en' ? 'hi' : 'en';
}

// ---------- display settings ----------
const SIZES = [14, 16, 18, 20];
let SIZE = Math.max(0, SIZES.indexOf(Number(store.get('portal-size')) || 16));
const setSize = i => { SIZE = Math.min(SIZES.length - 1, Math.max(0, i)); document.documentElement.style.fontSize = SIZES[SIZE] + 'px'; store.set('portal-size', SIZES[SIZE]); };
function setContrast(on) { if (on) document.documentElement.dataset.contrast = 'high'; else delete document.documentElement.dataset.contrast; $('#contrast').setAttribute('aria-pressed', String(on)); store.set('portal-contrast', on ? '1' : ''); }

// ---------- data ----------
// Every call is anonymous (no cookie), so the page shows exactly what a member of the public may see.
async function get(url) { const r = await fetch(url, { credentials: 'omit' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
async function post(url, body = {}) { const r = await fetch(url, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
const soft = p => p.catch(() => null);
const V = d => d?.value;
const gkey = g => String(g || '').split('/').pop();

let D = null; // last loaded data
const KNOWN = new Set(['aqm', 'weather', 'beds', 'junctions', 'itms', 'water', 'roadworks', 'permits', 'floodalert', 'gis', 'stops']);
async function load() {
  const [info, cat, status, alerts, fleet] = await Promise.all([soft(get('/api')), get('/catalogue/v1/search?limit=500'), soft(get('/status/v1')), soft(get('/cil/v1/alerts?limit=20')), soft(post('/cil/v1/publictransit/fleetPerformance'))]);
  const docs = cat.results;
  const providers = new Map(docs.filter(d => V(d.itemType) === 'provider').map(d => [d.id, V(d.name)]));
  const pdesc = new Map(docs.filter(d => V(d.itemType) === 'provider').map(d => [d.id, V(d.itemDescription) || '']));
  const groups = new Map(docs.filter(d => V(d.itemType) === 'resourceServerGroup').map(d => [d.id, { name: V(d.name), provider: V(d.provider) }]));
  const items = docs.filter(d => V(d.itemType) === 'resourceItem').map(d => {
    const g = groups.get(V(d.resourceServerGroup)) || {};
    return { id: d.id, name: V(d.name), desc: V(d.itemDescription), group: gkey(V(d.resourceServerGroup)), label: V(d.accessPolicyLabel) || 'protected', provider: g.provider, providerName: providers.get(g.provider) || '', at: V(d.location)?.geometry?.coordinates || V(d.location)?.coordinates, model: String(V(d.refDataModel) || '').split('/').pop().replace(/_dataModel\.json$|\.json$/, '') };
  });
  const pub = items.filter(i => i.label === 'public');
  const byGroup = g => pub.filter(i => i.group === g);
  const latest = async g => (await Promise.all(byGroup(g).map(i => soft(get('/resource/v1/latest?id=' + encodeURIComponent(i.id)))))).filter(Boolean).map(x => (Array.isArray(x.results) ? x.results[0] : x)).filter(Boolean);
  const rows = async g => { const i = byGroup(g)[0]; if (!i) return []; const r = await soft(get('/resource/v1/search?id=' + encodeURIComponent(i.id))); return r?.results || []; };
  const series = async g => Promise.all(byGroup(g).map(async i => (await soft(get('/resource/v1/search?id=' + encodeURIComponent(i.id))))?.results || []));
  const [aq, aqSeries, wx, beds, junc, bus, waterRaw, roads, permits, flood, zones] = await Promise.all([
    latest('aqm'), series('aqm'), latest('weather'), latest('beds'), latest('junctions'), latest('itms'), rows('water'), rows('roadworks'), rows('permits'), rows('floodalert'), rows('gis')]);
  const water = waterRaw.map(w => ({ ...w, date: String(w.date || '').slice(0, 10) })); // one day per row, whether given as a date or a date-time
  // Public datasets that have no built-in dashboard (for example ones a department adds later) get a simple table panel.
  const others = await Promise.all(pub.filter(i => !KNOWN.has(i.group)).slice(0, 12).map(async i => ({ item: i, rows: (await soft(get('/resource/v1/search?id=' + encodeURIComponent(i.id))))?.results || [] })));
  D = { others, pdesc, info, status, alerts: alerts || [], fleet: fleet?.output || null, providers, groups, items, aq, aqSeries, wx, beds, junc, bus, water, roads, permits, flood, zones, at: new Date() };
}

// ---------- helpers ----------
const BANDS = [30, 60, 90, 120, 250];
const band = v => { const i = BANDS.findIndex(b => v <= b); return i < 0 ? 5 : i; };
const loc = x => x?.location?.coordinates || x?.loc || D?.items.find(i => i.id === x?.id)?.at;
const speedCls = v => (v < 10 ? 'bad' : v < 20 ? 'warn' : 'ok');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function bars(list) { // [{label, value, max, cls, text}]
  return `<div class="bars">${list.map(b => `<div class="bar"><span class="lbl" title="${esc(b.label)}">${esc(b.label)}</span><span class="num">${esc(b.text ?? r1(b.value))}</span><span class="trk"><span class="fill ${b.cls || ''}" data-w="${Math.max(0, Math.min(100, (b.value / (b.max || 1)) * 100))}"></span></span></div>`).join('')}</div>`;
}
function spark(vals) {
  const v = vals.filter(Number.isFinite); if (v.length < 2) return '';
  const W = 300, H = 46, mn = Math.min(...v), mx = Math.max(...v), sx = W / (v.length - 1), sy = (H - 6) / ((mx - mn) || 1);
  const pts = v.map((y, i) => [i * sx, H - 3 - (y - mn) * sy]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="trend from ${r1(v[0])} to ${r1(last(v))}"><path class="a" d="${d}L${W} ${H}L0 ${H}Z"/><path class="l" d="${d}"/></svg>`;
}
const panel = (title, by, body, note = '') => `<section class="panel"><div class="panel-h"><h3>${esc(title)}</h3>${by ? `<span class="by">${esc(t('by'))}: ${esc(by)}</span>` : ''}</div>${body}${note ? `<p class="foot-note">${esc(note)}</p>` : ''}</section>`;
const providerOf = g => D.items.find(i => i.group === g)?.providerName || '';
const fmtTime = d => d.toLocaleTimeString(LANG === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' });
const paint = root => root.querySelectorAll('[data-w]').forEach(e => { e.style.width = e.dataset.w + '%'; });

// ---------- icons (stroke icons drawn here; no icon font or external file) ----------
const IC = {
  air: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  temp: '<path d="M10 14V4a2 2 0 1 1 4 0v10a4 4 0 1 1-4 0Z"/>',
  rain: '<path d="M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 18 9a3 3 0 0 1 0 6H7Z"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/>',
  water: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"/>',
  bed: '<path d="M3 18V7M3 13h18v5M21 13a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="10" r="1.6"/>',
  car: '<path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2"/><circle cx="8" cy="13" r="1"/><circle cx="16" cy="13" r="1"/>',
  bus: '<rect x="5" y="3" width="14" height="14" rx="2"/><path d="M5 11h14M8 20v-3M16 20v-3"/><circle cx="8.5" cy="14" r=".8"/><circle cx="15.5" cy="14" r=".8"/>',
  cone: '<path d="M9 4h6l4 16H5L9 4ZM7.5 10h9M6.5 15h11M3 20h18"/>',
  flood: '<path d="M3 15c2 0 2-1.5 4.5-1.5S10 15 12 15s2-1.5 4.5-1.5S19 15 21 15M3 19c2 0 2-1.5 4.5-1.5S10 19 12 19s2-1.5 4.5-1.5S19 19 21 19M12 3l5 6H7l5-6Z"/>',
  data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
};
const icon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || ''}</svg>`;

// ---------- city pulse (hero) ----------
function renderPulse() {
  const c = [];
  const card = (ic, col, n, unit, label, st) => c.push(`<div class="pc"><div class="ic" data-bg="${col}">${icon(ic)}</div><div class="n">${esc(n)}${unit ? `<small>${esc(unit)}</small>` : ''}</div><div class="l">${esc(label)}</div>${st ? `<span class="st">${esc(st)}</span>` : ''}</div>`);
  if (D.aq.length) { const v = avg(D.aq.map(a => a.PM2_5)); card('air', QCOL[band(v)], r1(v), 'PM2.5', t('aq'), t('band')[band(v)]); }
  if (D.wx.length) card('temp', '#f59e0b', r1(avg(D.wx.map(w => w.airTemperature))), '°C', t('temp'), `${t('humidity')} ${r1(avg(D.wx.map(w => w.relativeHumidity)))}%`);
  if (D.beds.length) card('bed', '#3b82f6', D.beds.reduce((s, b) => s + b.bedsFree, 0), '', t('beds'), `ICU ${D.beds.reduce((s, b) => s + (b.icuFree || 0), 0)}`);
  if (D.fleet?.fleetOnTimePercent != null) card('bus', '#a855f7', D.fleet.fleetOnTimePercent, '%', t('buses'), `${D.fleet.rows.length} ${t('busesN')}`);
  else if (D.junc.length) card('car', '#f97316', r1(avg(D.junc.map(j => j.avgSpeed))), t('kmh'), t('traffic'), '');
  $('#pulse').innerHTML = c.join('');
  $('#pulse').querySelectorAll('[data-bg]').forEach(e => { e.style.background = e.dataset.bg + '33'; e.style.color = e.dataset.bg; });
}

// ---------- tiles ----------
function renderTiles() {
  const out = [];
  let ic = 'data';
  const tile = (k, v, unit, s, cls, src) => out.push(`<div class="tile ${cls || ''}"><div class="top"><span class="ic">${icon(ic)}</span><div class="k">${esc(k)}</div></div><div class="v">${esc(v)}${unit ? ` <small>${esc(unit)}</small>` : ''}</div><div class="s">${s}</div>${src ? `<div class="src">${esc(t('source'))}: ${esc(src)}</div>` : ''}</div>`);
  if (D.aq.length) { ic = 'air'; const v = avg(D.aq.map(a => a.PM2_5)); const b = band(v); tile(t('aq'), r1(v), 'µg/m³', `<b>${esc(t('band')[b])}</b> · ${esc(t('avgOf', { n: D.aq.length }))}`, 'q' + b, providerOf('aqm')); }
  if (D.wx.length) {
    ic = 'temp'; tile(t('temp'), r1(avg(D.wx.map(w => w.airTemperature))), '°C', `${esc(t('humidity'))} ${r1(avg(D.wx.map(w => w.relativeHumidity)))}%`, '', providerOf('weather'));
    ic = 'rain'; const rain = Math.max(...D.wx.map(w => w.rainfall || 0)); tile(t('rain'), r1(rain), 'mm', esc(t('maxOf', { n: D.wx.length })), rain > 20 ? 'bad' : rain > 5 ? 'warn' : 'ok', providerOf('weather'));
  }
  if (D.water.length) {
    const day = last([...new Set(D.water.map(w => w.date))].sort()); const today = D.water.filter(w => w.date === day);
    const low = today.reduce((a, b) => (b.supplyHours < a.supplyHours ? b : a), today[0]);
    ic = 'water'; tile(t('water'), r1(avg(today.map(w => w.supplyHours))), t('hDay'), `${esc(t('cityAvg'))} · ${esc(t('lowest'))}: ${esc(low.zone)} (${r1(low.supplyHours)} ${esc(t('hrs'))}) · ${esc(day)}`, low.supplyHours < 4 ? 'warn' : 'ok', providerOf('water'));
  }
  ic = 'bed'; if (D.beds.length) { const f = D.beds.reduce((s, b) => s + b.bedsFree, 0), n = D.beds.reduce((s, b) => s + b.bedsTotal, 0), icu = D.beds.reduce((s, b) => s + (b.icuFree || 0), 0); tile(t('beds'), f, `${t('of')} ${n}`, `${esc(t('icuFree'))}: <b>${icu}</b>`, pct(f, n) < 10 ? 'bad' : pct(f, n) < 20 ? 'warn' : 'ok', providerOf('beds')); }
  ic = 'car'; if (D.junc.length) { const v = avg(D.junc.map(j => j.avgSpeed)); const s = D.junc.reduce((a, b) => (b.avgSpeed < a.avgSpeed ? b : a)); tile(t('traffic'), r1(v), t('kmh'), `${esc(t('slowest'))}: ${esc(s.name)} (${r1(s.avgSpeed)})`, speedCls(v), providerOf('junctions')); }
  ic = 'bus'; if (D.fleet?.fleetOnTimePercent != null) tile(t('buses'), D.fleet.fleetOnTimePercent, '%', `${D.fleet.rows.length} ${esc(t('bus'))}`, D.fleet.fleetOnTimePercent < 60 ? 'bad' : D.fleet.fleetOnTimePercent < 80 ? 'warn' : 'ok', providerOf('itms'));
  ic = 'cone'; if (D.roads.length) { const act = D.roads.filter(r => /progress/i.test(r.status)); tile(t('roadworks'), act.length, t('inProgress'), `${act.reduce((s, r) => s + (r.lanesClosed || 0), 0)} ${esc(t('lanesClosed'))}`, act.length ? 'warn' : 'ok', providerOf('roadworks')); }
  ic = 'flood'; const fl = activeFlood(); tile(t('flood'), fl.length, fl.length ? t('active') : '', fl.length ? esc(fl[0].ward + ': ' + nice(fl[0].text)) : esc(t('none')), fl.length ? 'bad' : 'ok', providerOf('floodalert'));
  ic = 'data'; const pubN = D.items.filter(i => i.label === 'public').length; tile(t('datasets'), pubN, '', `${esc(t('publicOf', { n: D.items.length }))} · ${D.providers.size} ${esc(t('depts'))}`, '', '');
  $('#tiles').innerHTML = out.join('');
}
// City-wide alerts from the intelligence layer (newest first, one per message) plus open items in the flood alert dataset.
function cityAlerts() {
  const seen = new Set(), out = [];
  for (const x of D.alerts) { const key = `${x.domain}|${x.ward}|${x.source}`; if (seen.has(key)) continue; seen.add(key); out.push({ domain: x.domain || '', ward: x.ward || '', text: x.msg || '', at: x.ts, red: /^red\b|severe|critical/i.test(x.msg || '') }); }
  for (const x of D.flood) if (!/clear|resolved|closed/i.test(x.status || '')) out.push({ domain: 'Flood', ward: x.zone || x.ward || '', text: x.message || x.description || x.alertLevel || '', at: x.issuedAt || x.observationDateTime, red: /red|severe/i.test(x.alertLevel || x.severity || '') });
  return out.slice(0, 4);
}
const activeFlood = () => cityAlerts().filter(a => a.domain === 'Flood');
const nice = x => String(x).replace(/urn:[\w.-]+:[\w./-]+/g, id => D.items.find(i => i.id === id)?.name.replace(/\s*\(demo\)$/, '') || id);
const alertLine = a => `<b>${esc(a.domain)}${a.ward ? ' · ' + esc(a.ward) : ''}</b>${esc(nice(a.text))}${a.at ? ` <span class="muted small">${esc(fmtTime(new Date(a.at)))}</span>` : ''}`;
function renderAlerts() {
  const al = cityAlerts();
  $('#alerts').innerHTML = al.length
    ? al.map(a => `<div class="alert ${a.red ? 'bad' : 'warn'}" role="status"><span aria-hidden="true">⚠</span><div>${alertLine(a)}</div></div>`).join('')
    : `<div class="alert ok" role="status"><span aria-hidden="true">✓</span><div>${esc(t('noAlerts'))}</div></div>`;
}

// ---------- map ----------
const LAYERS = [['aq', 'lAq', '#d93a2b'], ['traffic', 'lTraffic', '#f08a24'], ['beds', 'lBeds', '#2f5f8f'], ['bus', 'lBus', '#8e44ad'], ['wx', 'lWx', '#1f9d55']];
const ON = new Set(['aq', 'traffic', 'beds', 'bus']);
const QCOL = ['#1f9d55', '#8cc63f', '#f2c230', '#f08a24', '#d93a2b', '#8e1b1b'];
function renderMap() {
  const pts = [...D.aq, ...D.wx, ...D.beds, ...D.junc, ...D.bus].map(loc).filter(Boolean);
  const zc = D.zones.flatMap(z => z.boundary?.coordinates?.[0] || []);
  const all = zc.length ? zc : pts; if (!all.length) { $('#mapsvg').innerHTML = `<p class="muted">${esc(t('noData'))}</p>`; return; }
  let w = Math.min(...all.map(p => p[0])), e = Math.max(...all.map(p => p[0])), s = Math.min(...all.map(p => p[1])), n = Math.max(...all.map(p => p[1]));
  const padX = (e - w) * 0.04 || 0.01, padY = (n - s) * 0.04 || 0.01; w -= padX; e += padX; s -= padY; n += padY;
  const kx = Math.cos(((s + n) / 2) * Math.PI / 180), W = 720, H = Math.round(W * (n - s) / ((e - w) * kx));
  const X = lon => ((lon - w) / (e - w)) * W, Y = lat => ((n - lat) / (n - s)) * H;
  const P = c => `${X(c[0]).toFixed(1)},${Y(c[1]).toFixed(1)}`;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('mapTitle'))}">`;
  for (const z of D.zones) { const ring = z.boundary?.coordinates?.[0]; if (!ring) continue; const cx = Math.min(...ring.map(p => X(p[0]))) + 10, cy = Math.min(...ring.map(p => Y(p[1]))) + 22; svg += `<polygon class="zone" points="${ring.map(P).join(' ')}"/><text class="zone-l" x="${cx.toFixed(0)}" y="${cy.toFixed(0)}" text-anchor="start">${esc(z.wardId || z.zone || '')}</text>`; }
  if (/kanpur/i.test(D.info?.city || '')) { // approximate course of the Ganga along the north-east edge of the demo area
    const river = [[80.22, 26.545], [80.27, 26.528], [80.31, 26.512], [80.35, 26.49], [80.38, 26.468], [80.405, 26.445], [80.425, 26.42]];
    svg += `<path class="river" d="M${river.map(P).join('L')}"/><text class="river-l" x="${X(80.33).toFixed(0)}" y="${(Y(26.5) - 14).toFixed(0)}">${esc(t('river'))}</text>`;
  }
  const dot = (c, r, fill, title, label, shape = 'c', dx = 0, dy = 0) => {
    const x = X(c[0]) + dx, y = Y(c[1]) + dy;
    const g = shape === 's' ? `<rect class="pt" x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" rx="2" fill="${fill}"><title>${esc(title)}</title></rect>`
      : shape === 't' ? `<path class="pt" d="M${x} ${y - r - 1}L${x + r + 1} ${y + r}L${x - r - 1} ${y + r}Z" fill="${fill}"><title>${esc(title)}</title></path>`
      : shape === 'p' ? `<g><circle class="pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}"><title>${esc(title)}</title></circle><path d="M${x - r / 2} ${y}H${x + r / 2}M${x} ${y - r / 2}V${y + r / 2}" stroke="#fff" stroke-width="2.5"/></g>`
      : `<circle class="pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}"><title>${esc(title)}</title></circle>`;
    return g + (label ? `<text class="pt-l" x="${(x + r + 4).toFixed(1)}" y="${(y + 4).toFixed(1)}">${esc(label)}</text>` : '');
  };
  if (ON.has('wx')) for (const a of D.wx) if (loc(a)) svg += dot(loc(a), 7, '#1f9d55', `${a.id?.split('/').pop()}: ${r1(a.airTemperature)} °C, ${r1(a.rainfall)} mm`, `${r1(a.airTemperature)}°`, 't', 0, -22);
  if (ON.has('beds')) for (const b of D.beds) if (loc(b)) svg += dot(loc(b), 9, '#2f5f8f', `${b.name}: ${b.bedsFree} ${t('free')} ${t('of')} ${b.bedsTotal}, ICU ${b.icuFree}`, `${b.bedsFree}`, 'p', -16, 14);
  if (ON.has('traffic')) for (const j of D.junc) if (loc(j)) svg += dot(loc(j), 7, { ok: '#1f9d55', warn: '#f08a24', bad: '#d93a2b' }[speedCls(j.avgSpeed)], `${j.name}: ${r1(j.avgSpeed)} ${t('kmh')}, ${j.vehicleCount} ${t('vehicles')}`, '', 's', 16, -12);
  if (ON.has('aq')) for (const a of D.aq) if (loc(a)) svg += dot(loc(a), 10, QCOL[band(a.PM2_5)], `${a.NAME}: PM2.5 ${r1(a.PM2_5)}`, `${Math.round(a.PM2_5)}`);
  if (ON.has('bus')) for (const b of D.bus) if (loc(b)) svg += dot(loc(b), 6, '#8e44ad', `${b.busId} (${b.routeId}): ${r1(b.speed)} ${t('kmh')}, ${t('delay')} ${b.delayMinutes} ${t('minutes')}`, '');
  svg += '</svg>';
  $('#mapsvg').innerHTML = svg + `<p class="map-tip" id="maptip" aria-live="polite">${esc(t('tapHint'))}</p>`;
  $('#mapsvg').querySelectorAll('.pt').forEach(el => { el.onclick = () => { $('#maptip').textContent = el.querySelector('title')?.textContent || ''; }; });
  $('#layers').innerHTML = LAYERS.map(([k, l, c]) => `<label><input type="checkbox" value="${k}" ${ON.has(k) ? 'checked' : ''}> <span class="sw" data-c="${c}"></span> ${esc(t(l))}</label>`).join('');
  $('#layers').querySelectorAll('[data-c]').forEach(e => { e.style.background = e.dataset.c; });
  $('#layers').querySelectorAll('input').forEach(i => { i.onchange = () => { i.checked ? ON.add(i.value) : ON.delete(i.value); renderMap(); }; });
  $('#legend').innerHTML = t('band').map((b, i) => `<span><span class="sw" data-c="${QCOL[i]}"></span>${esc(b)}</span>`).join('') + `<span>· ${esc(t('bandNote'))}</span>`;
  $('#legend').querySelectorAll('[data-c]').forEach(e => { e.style.background = e.dataset.c; });
}

// ---------- dashboards ----------
function renderDash() {
  const P = [];
  if (D.aq.length) {
    const len = Math.min(...D.aqSeries.map(s => s.length).filter(Boolean)) || 0;
    const trend = Array.from({ length: len }, (_, k) => avg(D.aqSeries.filter(s => s.length).map(s => s[s.length - len + k].PM2_5)));
    P.push(panel(t('pAq'), providerOf('aqm'), bars(D.aq.map(a => ({ label: String(a.NAME || '').replace(/^AQ\s*/, ''), value: a.PM2_5, max: 250, cls: 'q' + band(a.PM2_5), text: `${r1(a.PM2_5)} · ${t('band')[band(a.PM2_5)]}` }))) + `<p class="foot-note">${esc(t('pAqTrend'))}</p>` + spark(trend), t('bandNote')));
  }
  if (D.wx.length) P.push(panel(t('pWx'), providerOf('weather'), `<div class="tbl-wrap"><table class="tbl"><tr><th>${esc(t('station'))}</th><th>°C</th><th>${esc(t('humid'))} %</th><th>${esc(t('wind'))} m/s</th><th>${esc(t('rainMm'))}</th></tr>${D.wx.map(w => `<tr><td>${esc(D.items.find(i => i.id === w.id)?.name.replace(/^Weather station,?\s*/i, '').replace(/\s*\(demo\)$/, '') || w.id)}</td><td class="n">${r1(w.airTemperature)}</td><td class="n">${r1(w.relativeHumidity)}</td><td class="n">${r1(w.windSpeed)}</td><td class="n">${r1(w.rainfall)}</td></tr>`).join('')}</table></div>`));
  if (D.water.length) {
    const days = [...new Set(D.water.map(w => w.date))].sort(); const day = last(days); const today = D.water.filter(w => w.date === day).sort((a, b) => String(a.zone).localeCompare(String(b.zone), undefined, { numeric: true }));
    P.push(panel(t('pWater'), providerOf('water'), bars(today.map(w => ({ label: w.zone, value: w.supplyHours, max: 24, cls: w.supplyHours < 4 ? 'bad' : w.supplyHours < 6 ? 'warn' : 'ok', text: `${r1(w.supplyHours)} ${t('hrs')} · ${r1(w.pressure)} ${t('bar')}` }))) + `<p class="foot-note">${esc(t('pWaterTrend'))}</p>` + spark(days.map(d => avg(D.water.filter(w => w.date === d).map(w => w.supplyHours)))), day));
  }
  if (D.beds.length) P.push(panel(t('pBeds'), providerOf('beds'), bars(D.beds.map(b => { const occ = pct(b.bedsTotal - b.bedsFree, b.bedsTotal); return { label: String(b.name).replace(/\s*\(demo\)$/, ''), value: occ, max: 100, cls: occ > 90 ? 'bad' : occ > 80 ? 'warn' : 'ok', text: `${b.bedsFree} ${t('free')} · ICU ${b.icuFree}` }; })), `% ${t('occupied')}`));
  if (D.junc.length) P.push(panel(t('pTraffic'), providerOf('junctions'), bars(D.junc.map(j => ({ label: j.name, value: j.avgSpeed, max: 50, cls: speedCls(j.avgSpeed), text: `${r1(j.avgSpeed)} ${t('kmh')} · ${j.vehicleCount}` }))), `${t('kmh')} · ${t('vehicles')}`));
  if (D.fleet?.rows?.length) {
    const delay = new Map(D.bus.map(b => [b.busId, b.delayMinutes]));
    P.push(panel(t('pBus'), providerOf('itms'), `<div class="kv"><div><b>${D.fleet.fleetOnTimePercent}%</b><span>${esc(t('onTime'))}</span></div><div><b>${D.fleet.rows.length}</b><span>${esc(t('bus'))}</span></div></div><div class="tbl-wrap"><table class="tbl"><tr><th>${esc(t('bus'))}</th><th>${esc(t('route'))}</th><th>${esc(t('onTime'))}</th><th>${esc(t('delay'))}</th></tr>${D.fleet.rows.map(r => `<tr><td>${esc(r.bus)}</td><td>${esc(r.route)}</td><td><span class="badge ${r.status === 'on time' ? 'ok' : 'warn'}">${r.onTimePercent}%</span></td><td class="n">${delay.has(r.bus) ? delay.get(r.bus) + ' ' + esc(t('minutes')) : '–'}</td></tr>`).join('')}</table></div>`));
  }
  if (D.roads.length) P.push(panel(t('pRoad'), providerOf('roadworks'), `<div class="tbl-wrap"><table class="tbl"><tr><th>${esc(t('road'))}</th><th>${esc(t('status'))}</th><th>${esc(t('lanes'))}</th></tr>${D.roads.map(r => `<tr><td>${esc(String(r.road).replace(/\s*\(demo\)$/, ''))}<br><span class="muted small">${esc(r.zone)} · ${esc(r.startDate)} ${esc(t('to'))} ${esc(r.endDate)}</span></td><td><span class="badge ${/progress/i.test(r.status) ? 'warn' : /done|complete/i.test(r.status) ? 'ok' : 'info'}">${esc(r.status)}</span></td><td class="n">${esc(r.lanesClosed)}</td></tr>`).join('')}</table></div>`));
  if (D.permits.length) {
    const st = {}; const zn = {}; for (const p of D.permits) { st[p.status] = (st[p.status] || 0) + 1; zn[p.zone] = (zn[p.zone] || 0) + 1; }
    const mx = Math.max(...Object.values(zn));
    P.push(panel(t('pPermit'), providerOf('permits'), `<div class="kv">${Object.entries(st).map(([k, v]) => `<div><b>${v}</b><span>${esc(k)}</span></div>`).join('')}</div><p class="foot-note">${esc(t('byZone'))}</p>` + bars(Object.entries(zn).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, v]) => ({ label: k, value: v, max: mx, text: String(v) })))));
  }
  for (const { item, rows } of D.others) {
    const recent = rows.slice(-5).reverse(); const cols = [...new Set(recent.flatMap(r => Object.keys(r)))].filter(k => !['@context', 'id', 'location'].includes(k) && recent.every(r => typeof r[k] !== 'object')).slice(0, 5);
    P.push(panel(item.name.replace(/\s*\(demo\)$/, ''), item.providerName, recent.length ? `<div class="tbl-wrap"><table class="tbl"><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${recent.map(r => `<tr>${cols.map(c => `<td${typeof r[c] === 'number' ? ' class="n"' : ''}>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</table></div>` : `<p class="muted">${esc(t('noData'))}</p>`, rows.length > 5 ? `${t('latestN', { n: 5 })} · ${rows.length} ${t('rowsTotal')}` : ''));
  }
  const fl = activeFlood();
  if (D.items.some(i => i.group === 'floodalert')) P.push(panel(t('pFlood'), providerOf('floodalert'), fl.length ? `<div class="alerts">${fl.map(a => `<div class="alert ${a.red ? 'bad' : 'warn'}"><div>${alertLine(a)}</div></div>`).join('')}</div>` : `<p>${esc(t('noAlerts'))}</p>`));
  $('#dashgrid').innerHTML = P.join('') || `<p class="muted">${esc(t('noData'))}</p>`;
  paint($('#dashgrid'));
}

// ---------- departments and open data ----------
function renderDepts() {
  $('#deptgrid').innerHTML = [...D.providers].map(([id, name]) => {
    const mine = D.items.filter(i => i.provider === id), pub = mine.filter(i => i.label === 'public').length, key = id.split('/').pop();
    return `<article class="dept"><h3>${esc(name)}</h3><p>${esc(ROLE[LANG][key] || ROLE.en[key] || D.pdesc.get(id) || '')}</p><div class="counts"><span class="badge info">${mine.length} ${esc(t('items'))}</span><span class="badge ok">${pub} ${esc(t('publicN'))}</span></div><button type="button" data-p="${esc(id)}">${esc(t('viewData'))}</button></article>`;
  }).join('');
  $('#deptgrid').querySelectorAll('button[data-p]').forEach(b => { b.onclick = () => { $('#fdept').value = b.dataset.p; renderData(); $('#data').scrollIntoView({ behavior: 'smooth' }); }; });
}
function renderFilters() {
  const d = $('#fdept').value, a = $('#facc').value;
  $('#fdept').innerHTML = `<option value="">${esc(t('all'))}</option>` + [...D.providers].map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('');
  $('#facc').innerHTML = `<option value="">${esc(t('all'))}</option>` + ['public', 'protected', 'private', 'confidential'].map(k => `<option value="${k}">${esc(t('accessName')[k])}</option>`).join('');
  $('#fdept').value = d; $('#facc').value = a;
}
function renderData() {
  const q = $('#q').value.trim().toLowerCase(), d = $('#fdept').value, a = $('#facc').value;
  const rows = D.items.filter(i => (!d || i.provider === d) && (!a || i.label === a) && (!q || `${i.name} ${i.desc} ${i.providerName} ${i.model}`.toLowerCase().includes(q)));
  const cls = { public: 'ok', protected: 'info', private: 'warn', confidential: 'bad' };
  $('#datatable').innerHTML = `<div class="tbl-wrap"><table class="tbl"><tr><th>${esc(t('dataset'))}</th><th>${esc(t('department'))}</th><th>${esc(t('access'))}</th><th>${esc(t('get'))}</th></tr>${rows.map(i => `<tr><td><b>${esc(i.name)}</b><br><span class="muted small">${esc(i.desc || '')}${i.model ? ' · ' + esc(i.model) : ''}</span></td><td>${esc(i.providerName)}</td><td><span class="badge ${cls[i.label] || 'info'}" title="${esc(t('accessHelp')[i.label] || '')}">${esc(t('accessName')[i.label] || i.label)}</span><br><span class="muted small">${esc(t('accessHelp')[i.label] || '')}</span></td><td class="dl">${i.label === 'public' ? `<a href="/resource/v1/search?id=${encodeURIComponent(i.id)}" target="_blank" rel="noopener">${esc(t('download'))}</a>` : `<span class="muted small">${esc(t('loginToAsk'))}</span>`}</td></tr>`).join('')}</table></div><p class="muted small">${rows.length} ${esc(t('items'))}</p>`;
}
function renderStatus() {
  const s = D.status?.services || [];
  $('#services').innerHTML = s.map(x => `<div class="svc"><div><b>${esc(x.name || x.service)}</b><small>${x.uptimePercent != null ? esc(x.uptimePercent + '% ' + t('uptime')) : ''}</small></div><span class="badge ${x.status === 'up' ? 'ok' : 'bad'}">${esc(x.status === 'up' ? t('up') : t('down'))}</span></div>`).join('') || `<p class="muted">${esc(t('noData'))}</p>`;
}

function renderAll() {
  if (!D) return;
  const city = String(D.info?.city || '').replace(/\s*\(demo data\)\s*$/i, '');
  $('#city-name').textContent = city;
  document.title = `${city} ${t('portalName')} (demo)`;
  $('#updated').textContent = fmtTime(D.at);
  renderPulse(); renderTiles(); renderAlerts(); renderMap(); renderDash(); renderDepts(); renderFilters(); renderData(); renderStatus();
  paint(document);
}

async function refresh() {
  try { await load(); renderAll(); } catch (e) { console.error(e); if (!D) $('#tiles').innerHTML = `<p class="muted">${esc(t('noData'))}</p>`; }
}

document.addEventListener('DOMContentLoaded', () => {
  setSize(SIZE); setContrast(store.get('portal-contrast') === '1'); applyLang();
  $('#fs-dn').onclick = () => setSize(SIZE - 1); $('#fs-up').onclick = () => setSize(SIZE + 1); $('#fs-0').onclick = () => setSize(1);
  $('#contrast').onclick = () => setContrast(!document.documentElement.dataset.contrast);
  $('#lang').onclick = () => { LANG = LANG === 'en' ? 'hi' : 'en'; store.set('portal-lang', LANG); applyLang(); renderAll(); };
  $('#q').oninput = () => D && renderData(); $('#fdept').onchange = () => D && renderData(); $('#facc').onchange = () => D && renderData();
  refresh(); setInterval(refresh, 60e3);
});
