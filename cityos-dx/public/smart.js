// Smart features for the public portal (loaded after portal.js and sharing its helpers):
//  - a photo added to "Report a problem" shows where it was taken, read from the photo's own GPS data,
//    only after the visitor ticks the consent box; the photo never leaves the device (not uploaded or saved);
//  - tapping a drawn landmark in the skyline shows where that place is on the city map;
//  - quick search (Ctrl+K) across sections, datasets, departments and the past incidents;
//  - light/dark switch, highlighted menu while scrolling, a bottom menu on phones, shorter long lists.
'use strict';

Object.assign(T.en, {
  findBtn: 'Search', kpPh: 'Search sections, datasets, departments, past incidents…', kpFoot: '↑ ↓ to move · Enter to open · Esc to close', kpNone: 'Nothing found.',
  kSec: 'Section', kData: 'Dataset', kDept: 'Department', kInc: 'Past incident', kPlace: 'Place',
  bnHome: 'Home', bnReport: 'Report', bnPast: 'Past', thAuto: 'Auto', thLight: 'Light', thDark: 'Dark',
  showAllN: 'Show all {n}', dashMore: 'Show all {n} dashboards', dashLess: 'Show fewer dashboards',
  lmWhere: 'show where it is', lmApprox: 'Approximate location', lmShow: 'Show on the city map', lmDrawn: 'Drawing made for this site, not a photo.',
  lmD_iit: 'Indian Institute of Technology campus in Kalyanpur, in the north-west of the city.',
  lmD_greenpark: 'Cricket stadium in Civil Lines, close to the Ganga. International matches are played here.',
  lmD_ghantaghar: 'Clock tower at a busy crossing in the old city, near Kanpur Central railway station.',
  lmD_jk: 'White marble Radha-Krishna temple in Sarvodaya Nagar, known for its tall towers.',
  lmD_barrage: 'Barrage across the Ganga in the north of the city. It holds back river water for the city supply and carries a road.',
  phTitle: 'Photos on the map', phLead: 'Tap a photo to see where it was taken. Add your own with "Report a problem": it stays on your device.',
  phAdd: 'Add a photo (optional)', phPick: 'Choose or take a photo', phConsent: 'Read the location saved inside this photo (GPS). The photo and its location stay on this device and are not sent.',
  phPrivacy: 'Privacy: nothing is uploaded or saved. Untick the box or press Remove location at any time. See the privacy policy (Digital Personal Data Protection Act, 2023).',
  phNoGps: 'This photo has no saved location. Many phones remove it when a photo is picked. You can use your current location instead.',
  phNoJpeg: 'Location can be read from JPEG photos only. You can use your current location instead.',
  phNeedOk: 'Tick the box above if you want the site to read where the photo was taken.',
  phAt: 'Taken at {lat}, {lon}', phTaken: 'on {d}', phZone: 'in {z}', phNear: 'about {km} km from {lm}', phOut: 'This place is outside the demo map area.',
  phRemove: 'Remove location', phUseMe: 'Use my location', phFromMe: 'Your current location', phRemoved: 'Location removed. The photo has no place on the map.',
  phSentNote: 'Your photo is now on the city map on this page only. It disappears when you reload or close the page.',
  phSample: 'Sample: drawn picture, made-up place', phYours: 'Your photo (on this device only)', phShow: 'Show on map', phNoLoc: 'No location',
  phS1: 'Waterlogging', phS2: 'Streetlight not working', phS3: 'Garbage not collected',
});
Object.assign(T.hi, {
  findBtn: 'खोजें', kpPh: 'भाग, डेटासेट, विभाग, पिछली घटनाएँ खोजें…', kpFoot: '↑ ↓ चुनें · Enter खोलें · Esc बंद करें', kpNone: 'कुछ नहीं मिला।',
  kSec: 'भाग', kData: 'डेटासेट', kDept: 'विभाग', kInc: 'पिछली घटना', kPlace: 'स्थान',
  bnHome: 'मुख्य', bnReport: 'शिकायत', bnPast: 'पिछली', thAuto: 'अपने-आप', thLight: 'हल्का', thDark: 'गहरा',
  showAllN: 'सभी {n} दिखाएँ', dashMore: 'सभी {n} डैशबोर्ड दिखाएँ', dashLess: 'कम डैशबोर्ड दिखाएँ',
  lmWhere: 'कहाँ है, देखें', lmApprox: 'अनुमानित स्थान', lmShow: 'शहर के नक्शे पर दिखाएँ', lmDrawn: 'इस साइट के लिए बनाया गया चित्र, फ़ोटो नहीं।',
  lmD_iit: 'कल्याणपुर में भारतीय प्रौद्योगिकी संस्थान का परिसर, शहर के उत्तर-पश्चिम में।',
  lmD_greenpark: 'सिविल लाइंस में गंगा के पास क्रिकेट स्टेडियम। यहाँ अंतरराष्ट्रीय मैच होते हैं।',
  lmD_ghantaghar: 'पुराने शहर के व्यस्त चौराहे पर घंटाघर, कानपुर सेंट्रल रेलवे स्टेशन के पास।',
  lmD_jk: 'सर्वोदय नगर में सफ़ेद संगमरमर का राधा-कृष्ण मंदिर, ऊँचे शिखरों के लिए प्रसिद्ध।',
  lmD_barrage: 'शहर के उत्तर में गंगा पर बैराज। यह शहर की जल आपूर्ति के लिए नदी का पानी रोकता है और इस पर सड़क भी है।',
  phTitle: 'नक्शे पर फ़ोटो', phLead: 'फ़ोटो पर टैप करें और देखें कि वह कहाँ ली गई। "समस्या बताएँ" से अपनी फ़ोटो जोड़ें: वह आपके डिवाइस पर ही रहती है।',
  phAdd: 'फ़ोटो जोड़ें (वैकल्पिक)', phPick: 'फ़ोटो चुनें या खींचें', phConsent: 'इस फ़ोटो में सहेजा गया स्थान (GPS) पढ़ें। फ़ोटो और उसका स्थान इसी डिवाइस पर रहते हैं और भेजे नहीं जाते।',
  phPrivacy: 'गोपनीयता: कुछ भी अपलोड या सहेजा नहीं जाता। बॉक्स हटाएँ या "स्थान हटाएँ" कभी भी दबाएँ। गोपनीयता नीति देखें (डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023)।',
  phNoGps: 'इस फ़ोटो में स्थान सहेजा नहीं है। कई फ़ोन फ़ोटो चुनते समय इसे हटा देते हैं। आप अपनी अभी की लोकेशन इस्तेमाल कर सकते हैं।',
  phNoJpeg: 'स्थान सिर्फ़ JPEG फ़ोटो से पढ़ा जा सकता है। आप अपनी अभी की लोकेशन इस्तेमाल कर सकते हैं।',
  phNeedOk: 'अगर आप चाहते हैं कि साइट पढ़े कि फ़ोटो कहाँ ली गई, तो ऊपर का बॉक्स चुनें।',
  phAt: 'स्थान {lat}, {lon}', phTaken: '{d} को', phZone: '{z} में', phNear: '{lm} से लगभग {km} किमी', phOut: 'यह जगह डेमो नक्शे के क्षेत्र से बाहर है।',
  phRemove: 'स्थान हटाएँ', phUseMe: 'मेरी लोकेशन इस्तेमाल करें', phFromMe: 'आपकी अभी की लोकेशन', phRemoved: 'स्थान हटा दिया गया। फ़ोटो नक्शे पर नहीं दिखेगी।',
  phSentNote: 'आपकी फ़ोटो अब सिर्फ़ इस पेज पर शहर के नक्शे पर है। पेज रीलोड या बंद करने पर हट जाएगी।',
  phSample: 'नमूना: बनाया गया चित्र, काल्पनिक स्थान', phYours: 'आपकी फ़ोटो (सिर्फ़ इस डिवाइस पर)', phShow: 'नक्शे पर दिखाएँ', phNoLoc: 'स्थान नहीं',
  phS1: 'जलभराव', phS2: 'स्ट्रीटलाइट खराब', phS3: 'कचरा नहीं उठा',
});

// ---------- landmarks (approximate real places of the drawings in the skyline) ----------
const LANDMARKS = {
  iit: [80.2329, 26.5123], greenpark: [80.3476, 26.4827], ghantaghar: [80.3545, 26.4583], jk: [80.3082, 26.4805], barrage: [80.3172, 26.5118],
};
let FOCUS = null; // {at:[lon,lat], label} drawn as a big pin on the city map

// ---------- photos: kept in this page's memory only, never stored or sent ----------
const svgPic = (sky, body) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs><rect width="320" height="200" fill="url(#s)"/>${body}</svg>`);
const SAMPLES = [
  { cat: 'phS1', at: [80.3150, 26.4440], src: svgPic(['#5d7389', '#a9b9c8'], '<rect y="120" width="320" height="80" fill="#6f8aa3"/><path d="M0 150 Q40 140 80 150 T160 150 T240 150 T320 150 V200 H0Z" fill="#4f7fa8" opacity=".8"/><rect x="30" y="60" width="70" height="70" fill="#8a7a6a"/><rect x="200" y="40" width="90" height="90" fill="#9c8b78"/><rect x="120" y="128" width="60" height="22" rx="6" fill="#c24a3a"/><g stroke="#dfe8f0" stroke-width="2" opacity=".7"><path d="M20 10l-6 20M70 0l-6 20M130 12l-6 20M190 4l-6 20M250 14l-6 20M300 2l-6 20"/></g>') },
  { cat: 'phS2', at: [80.2620, 26.4990], src: svgPic(['#0b1a2e', '#1d3550'], '<rect y="150" width="320" height="50" fill="#2a3442"/><rect x="150" y="40" width="6" height="110" fill="#6d7a88"/><path d="M153 40 Q175 30 200 42" stroke="#6d7a88" stroke-width="5" fill="none"/><ellipse cx="202" cy="46" rx="12" ry="5" fill="#39424d"/><rect x="40" y="90" width="60" height="60" fill="#17222f"/><rect x="230" y="80" width="70" height="70" fill="#17222f"/><rect x="52" y="104" width="10" height="10" fill="#f6cf6b"/><rect x="250" y="96" width="10" height="10" fill="#f6cf6b"/>') },
  { cat: 'phS3', at: [80.3505, 26.4605], src: svgPic(['#9cc6e8', '#e7f1f8'], '<rect y="130" width="320" height="70" fill="#b9ada0"/><rect x="0" y="60" width="110" height="80" fill="#d8c3a5"/><rect x="230" y="50" width="90" height="90" fill="#c9b18f"/><path d="M110 150 q20 -30 45 -10 q15 -25 40 0 q20 -10 30 12 z" fill="#6c7a4f"/><circle cx="140" cy="140" r="9" fill="#e0e0e0"/><circle cx="178" cy="136" r="7" fill="#3a6fb0"/><rect x="160" y="146" width="18" height="8" fill="#c94f3d"/>') },
];
const PHOTOS = [];   // photos the visitor added in this visit: {src, at, cat, when}
let DRAFT = null;    // photo in the report form being filled: {src, buf, jpeg, gps, at, when, fromMe}

// Read the GPS position and the time taken from a JPEG photo's EXIF block. Runs in the browser only.
function readExif(buf) {
  try {
    const v = new DataView(buf); if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 10 < v.byteLength) {
      const m = v.getUint16(o), len = v.getUint16(o + 2); if ((m & 0xFF00) !== 0xFF00) return null;
      if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966 && v.getUint16(o + 8) === 0) return tiff(v, o + 10);
      if (m === 0xFFDA) return null; o += 2 + len;
    }
  } catch { /* damaged file */ }
  return null;
}
function tiff(v, t) {
  const le = v.getUint16(t) === 0x4949, u16 = p => v.getUint16(t + p, le), u32 = p => v.getUint32(t + p, le);
  if (u16(2) !== 42) return null;
  const ifd = p => { const n = u16(p), out = {}; for (let i = 0; i < n; i++) { const e = p + 2 + i * 12; out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 }; } return out; };
  const ascii = e => { if (!e) return ''; const p = e.count > 4 ? u32(e.at) : e.at; let s = ''; for (let i = 0; i < e.count - 1; i++) s += String.fromCharCode(v.getUint8(t + p + i)); return s; };
  const rats = e => { const p = u32(e.at), r = []; for (let i = 0; i < e.count; i++) { const d = u32(p + i * 8 + 4); r.push(d ? u32(p + i * 8) / d : 0); } return r; };
  const dms = e => { const [d, m, s] = rats(e); return d + (m || 0) / 60 + (s || 0) / 3600; };
  const top = ifd(u32(4)), out = {};
  if (top[0x8769]) { const ex = ifd(u32(top[0x8769].at)); const d = ascii(ex[0x9003]); if (/^\d{4}:\d\d:\d\d \d\d:\d\d/.test(d)) out.when = d.replace(/^(\d{4}):(\d\d):(\d\d) /, '$1-$2-$3T'); }
  if (top[0x8825]) {
    const g = ifd(u32(top[0x8825].at));
    if (g[2] && g[4]) {
      let lat = dms(g[2]), lon = dms(g[4]);
      if (ascii(g[1]).toUpperCase() === 'S') lat = -lat; if (ascii(g[3]).toUpperCase() === 'W') lon = -lon;
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) out.at = [lon, lat];
    }
  }
  return out;
}

// Where a point is: the demo zone that contains it and the nearest drawn landmark.
const inRing = (p, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
const zoneAt = p => D?.zones.find(z => z.boundary?.coordinates?.[0] && inRing(p, z.boundary.coordinates[0]))?.wardId || '';
const nearestLm = p => Object.entries(LANDMARKS).map(([k, c]) => [k, km(p, c)]).sort((a, b) => a[1] - b[1])[0];
const fmtWhen = s => { const d = new Date(s); return Number.isNaN(+d) ? '' : new Intl.DateTimeFormat(LANG === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d); };
function placeLine(at, when) {
  const [k, d] = nearestLm(at), z = zoneAt(at);
  const bits = [t('phAt', { lat: at[1].toFixed(5), lon: at[0].toFixed(5) })];
  if (when) bits.push(t('phTaken', { d: fmtWhen(when) }));
  if (z) bits.push(t('phZone', { z })); if (d < 30) bits.push(t('phNear', { km: r1(d), lm: t(LM_KEY[k]) }));
  return bits.join(' · ');
}

// A small map with one pin, built on the same frame as the city map.
const PIN = (x, y, cls = '') => `<g class="pin ${cls}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle class="pin-ring" r="16"/><path d="M0 0c-7-9-11-13-11-19a11 11 0 1 1 22 0c0 6-4 10-11 19Z"/><circle cy="-19" r="4" fill="#fff"/></g>`;
function pinMap(at, label) {
  const F = mapFrame(560); if (!F) return '';
  const x = F.X(at[0]), y = F.Y(at[1]), inside = x >= 0 && x <= F.W && y >= 0 && y <= F.H;
  return `<div class="mini-map"><svg viewBox="0 0 ${F.W} ${F.H}" role="img" aria-label="${esc(label)}">${F.base}${inside ? PIN(x, y, 'big') : ''}</svg>${inside ? '' : `<p class="small muted">${esc(t('phOut'))}</p>`}</div>`;
}

// ---------- report form: photo with optional location ----------
window.smartReport = body => {
  const form = $('#rf', body); if (!form) return;
  DRAFT = null;
  form.querySelector('button').insertAdjacentHTML('beforebegin', `<fieldset class="ph"><legend>${esc(t('phAdd'))}</legend>
    <label class="ph-drop"><input type="file" id="ph-file" accept="image/*"><span>${icon('pin')} ${esc(t('phPick'))}</span></label>
    <label class="ph-ok"><input type="checkbox" id="ph-ok"> <span>${esc(t('phConsent'))}</span></label>
    <div id="ph-out" aria-live="polite"></div>
    <p class="small muted">${esc(t('phPrivacy'))} <a href="/info.html#privacy">${esc(t('fPrivacy'))}</a></p></fieldset>`);
  $('#ph-file').onchange = async e => {
    const f = e.target.files?.[0]; if (!f) { DRAFT = null; drawDraft(); return; }
    const buf = await f.arrayBuffer();
    DRAFT = { src: await thumb(f), buf, jpeg: new DataView(buf).byteLength > 2 && new DataView(buf).getUint16(0) === 0xFFD8, gps: null };
    readDraft(); drawDraft();
  };
  $('#ph-ok').onchange = () => { readDraft(); drawDraft(); };
};
function readDraft() {
  if (!DRAFT) return;
  if (DRAFT.fromMe && $('#ph-ok').checked) return; // keep a location the visitor gave with the button
  const ex = $('#ph-ok').checked && DRAFT.jpeg ? readExif(DRAFT.buf) : null;
  DRAFT.gps = ex; DRAFT.at = ex?.at || null; DRAFT.when = ex?.when || null; DRAFT.fromMe = false;
  if (DRAFT.at) { const z = zoneAt(DRAFT.at), sel = $('#rf select[name="zone"]'); if (z && sel) sel.value = z; }
}
// A small copy of the photo for the page (the original file is not kept).
async function thumb(file) {
  try {
    const bmp = await createImageBitmap(file), k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.82);
  } catch { return ''; }
}
function drawDraft() {
  const out = $('#ph-out'); if (!out) return;
  if (!DRAFT) { out.innerHTML = ''; return; }
  const ok = $('#ph-ok').checked;
  let info;
  if (DRAFT.at) info = `<p class="ph-where">${icon('pin')} <b>${esc(DRAFT.fromMe ? t('phFromMe') : '')}</b> ${esc(placeLine(DRAFT.at, DRAFT.when))}</p>${pinMap(DRAFT.at, t('mapTitle'))}<button type="button" class="cta-sm" id="ph-rm">${esc(t('phRemove'))}</button>`;
  else if (!ok) info = `<p class="small muted">${esc(t('phNeedOk'))}</p>`;
  else info = `<p class="small">${esc(t(DRAFT.jpeg ? 'phNoGps' : 'phNoJpeg'))}</p><button type="button" class="cta-sm" id="ph-me">${icon('pin')} ${esc(t('phUseMe'))}</button>`;
  out.innerHTML = `<div class="ph-card">${DRAFT.src ? `<img src="${DRAFT.src}" alt="">` : ''}<div>${info}</div></div>`;
  if ($('#ph-rm')) $('#ph-rm').onclick = () => { DRAFT.at = null; DRAFT.when = null; DRAFT.fromMe = false; $('#ph-ok').checked = false; drawDraft(); $('#ph-out').insertAdjacentHTML('afterbegin', `<p class="small">${esc(t('phRemoved'))}</p>`); };
  if ($('#ph-me')) $('#ph-me').onclick = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(p => { DRAFT.at = [p.coords.longitude, p.coords.latitude]; DRAFT.when = null; DRAFT.fromMe = true; drawDraft(); }, () => {}, { timeout: 8000 });
  };
}
window.smartReportSent = f => {
  if (!DRAFT?.src) return;
  PHOTOS.unshift({ src: DRAFT.src, at: DRAFT.at, cat: f.cat, when: DRAFT.when, mine: true });
  DRAFT = null; renderPhotos(); renderMap();
  $('#rdone').insertAdjacentHTML('beforeend', `<p class="small">${esc(t('phSentNote'))}</p>`);
};

// ---------- gallery and map pins ----------
const allPhotos = () => [...PHOTOS, ...SAMPLES.map(s => ({ ...s, cat: t(s.cat), sample: true }))];
function renderPhotos() {
  const box = $('#photos'); if (!box) return;
  box.innerHTML = allPhotos().map((p, i) => `<button type="button" class="photo" data-ph="${i}"><img src="${p.src}" alt=""><span class="photo-t"><b>${esc(p.cat)}</b><small>${esc(p.sample ? t('phSample') : t('phYours'))}</small><small>${icon('pin')} ${esc(p.at ? (zoneAt(p.at) || t('lmApprox')) : t('phNoLoc'))}</small></span></button>`).join('');
  box.querySelectorAll('[data-ph]').forEach(b => { b.onclick = () => openPhoto(+b.dataset.ph); });
}
function openPhoto(i) {
  const p = allPhotos()[i]; if (!p) return;
  $('#qd-title').textContent = p.cat;
  $('#qd-body').innerHTML = `<img class="ph-big" src="${p.src}" alt="">${p.sample ? `<p class="warn-box small">${esc(t('phSample'))}</p>` : `<p class="small muted">${esc(t('phYours'))}</p>`}`
    + (p.at ? `<p class="ph-where">${icon('pin')} ${esc(placeLine(p.at, p.when))}</p>${pinMap(p.at, p.cat)}<p><button type="button" class="cta-sm primary" id="ph-go">${esc(t('lmShow'))}</button></p>` : `<p>${esc(t('phNoLoc'))}</p>`);
  if ($('#ph-go')) $('#ph-go').onclick = () => focusMap(p.at, p.cat);
  showDlg($('#qd'));
}
function focusMap(at, label) {
  FOCUS = { at, label }; $('#qd').close?.(); renderMap();
  $('#map').scrollIntoView({ behavior: 'smooth' }); const tip = $('#maptip'); if (tip) tip.textContent = `${label} · ${t('lmApprox')}`;
}
window.smartPins = (X, Y) => {
  let s = '';
  allPhotos().forEach((p, i) => { if (p.at) s += `<g class="ph-pin" data-ph="${i}" transform="translate(${X(p.at[0]).toFixed(1)} ${Y(p.at[1]).toFixed(1)})"><rect x="-11" y="-11" width="22" height="22" rx="6"/><path d="M-6 -3h3l1.5-2h3l1.5 2h3v8h-12Z M0 0.5a2 2 0 1 0 .01 0" /><title>${esc(p.cat)}</title></g>`; });
  if (FOCUS) s += PIN(X(FOCUS.at[0]), Y(FOCUS.at[1]), 'big') + `<text class="pin-l" x="${(X(FOCUS.at[0]) + 16).toFixed(1)}" y="${(Y(FOCUS.at[1]) - 22).toFixed(1)}">${esc(FOCUS.label)}</text>`;
  return s;
};
function openLandmark(k) {
  const at = LANDMARKS[k], name = t(LM_KEY[k]); if (!at) return;
  $('#qd-title').textContent = name;
  $('#qd-body').innerHTML = `<p>${esc(t('lmD_' + k))}</p><p class="ph-where">${icon('pin')} ${esc(t('lmApprox'))}: ${at[1].toFixed(4)}, ${at[0].toFixed(4)}${zoneAt(at) ? ' · ' + esc(t('phZone', { z: zoneAt(at) })) : ''}</p>${pinMap(at, name)}<p class="small muted">${esc(t('lmDrawn'))}</p><p><button type="button" class="cta-sm primary" id="lm-go">${esc(t('lmShow'))}</button></p>`;
  $('#lm-go').onclick = () => focusMap(at, name);
  showDlg($('#qd'));
}
const showDlg = d => { if (d.open) return; if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); };

// ---------- quick search ----------
let KP = [], KI = 0;
function kpItems() {
  const sec = [...document.querySelectorAll('#menu a')].map(a => ({ k: t('kSec'), name: a.textContent, go: () => { location.href = a.getAttribute('href'); } }));
  if (!D) return sec;
  const lms = Object.keys(LANDMARKS).map(k => ({ k: t('kPlace'), name: t(LM_KEY[k]), go: () => openLandmark(k) }));
  const data = D.items.map(i => ({ k: t('kData'), name: i.name, sub: i.providerName, go: () => { $('#q').value = i.name; renderData(); $('#data').scrollIntoView({ behavior: 'smooth' }); } }));
  const depts = [...D.providers].map(([id, n]) => ({ k: t('kDept'), name: n, go: () => { $('#fdept').value = id; renderData(); $('#data').scrollIntoView({ behavior: 'smooth' }); } }));
  const inc = (D.incidents || []).map(x => ({ k: t('kInc'), name: x.summary, sub: `${x.date} · ${String(x.place).split(/[;(]/)[0]}`, go: () => { HF.open = x.incidentId; HF.all = true; HF.type = ''; HF.year = ''; renderHistory(); document.getElementById('inc-' + x.incidentId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }));
  return [...sec, ...lms, ...depts, ...data, ...inc];
}
function kpDraw() {
  const q = $('#kp-in').value.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
  KP = kpItems().filter(x => words.every(w => `${x.name} ${x.sub || ''} ${x.k}`.toLowerCase().includes(w))).slice(0, 40); KI = Math.min(KI, Math.max(0, KP.length - 1));
  $('#kp-list').innerHTML = KP.length ? KP.map((x, i) => `<li role="option" data-i="${i}" aria-selected="${i === KI}"><span class="kp-k">${esc(x.k)}</span><span class="kp-n">${esc(x.name)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></li>`).join('') : `<li class="muted">${esc(t('kpNone'))}</li>`;
  $('#kp-list').querySelectorAll('[data-i]').forEach(li => { li.onclick = () => kpGo(+li.dataset.i); });
  $('#kp-list').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}
function kpGo(i) { const x = KP[i]; if (!x) return; $('#kp').close(); x.go(); }
function kpOpen() { $('#kp-in').placeholder = t('kpPh'); $('#kp-in').value = ''; KI = 0; kpDraw(); showDlg($('#kp')); $('#kp-in').focus(); }

// ---------- light / dark ----------
const THEMES = ['', 'light', 'dark'];
function themeLabel() { let v = ''; try { v = localStorage.getItem('portal-theme') || ''; } catch { /* blocked */ } $('#theme-l').textContent = t(v === 'light' ? 'thLight' : v === 'dark' ? 'thDark' : 'thAuto'); return v; }

// ---------- after every render ----------
let DASH_ALL = false;
window.renderSmart = () => {
  renderPhotos(); themeLabel();
  const g = $('#dashgrid'), n = g.children.length;
  g.classList.toggle('short', !DASH_ALL && n > 6);
  let b = $('#dash-more');
  if (n > 6) {
    if (!b) { g.insertAdjacentHTML('afterend', '<p><button type="button" class="cta-sm" id="dash-more"></button></p>'); b = $('#dash-more'); b.onclick = () => { DASH_ALL = !DASH_ALL; window.renderSmart(); if (!DASH_ALL) $('#dash').scrollIntoView({ behavior: 'smooth' }); }; }
    b.textContent = DASH_ALL ? t('dashLess') : t('dashMore', { n });
  } else b?.remove();
};

document.addEventListener('DOMContentLoaded', () => {
  // landmark drawings in the skyline (the drawing is rebuilt on every refresh, so listen on its box)
  const sk = $('#skyline');
  sk.addEventListener('click', e => { const h = e.target.closest('.sk-hit'); if (h) openLandmark(h.dataset.lm); });
  sk.addEventListener('keydown', e => { const h = e.target.closest('.sk-hit'); if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openLandmark(h.dataset.lm); } });
  // photo pins on the city map
  $('#mapsvg').addEventListener('click', e => { const p = e.target.closest('.ph-pin'); if (p) openPhoto(+p.dataset.ph); });
  // quick search
  $('#find-btn').onclick = kpOpen; $('#bn-find').onclick = kpOpen; $('#kp-x').onclick = () => $('#kp').close();
  $('#kp').onclick = e => { if (e.target === $('#kp')) $('#kp').close(); };
  $('#kp-in').oninput = () => { KI = 0; kpDraw(); };
  $('#kp-in').onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); KI = Math.min(KP.length - 1, KI + 1); kpDraw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); KI = Math.max(0, KI - 1); kpDraw(); }
    else if (e.key === 'Enter') { e.preventDefault(); kpGo(KI); }
  };
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); kpOpen(); } else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); kpOpen(); } });
  // bottom menu on phones
  $('#bn-report').onclick = () => D && openQuick('report');
  // light / dark switch: Auto (follows the Kanpur clock) → Light → Dark
  $('#theme').onclick = () => { const v = THEMES[(THEMES.indexOf(themeLabel()) + 1) % THEMES.length]; try { v ? localStorage.setItem('portal-theme', v) : localStorage.removeItem('portal-theme'); } catch { /* blocked */ } window.citySky?.refresh(); themeLabel(); };
  themeLabel();
  // highlight the menu item of the section in view
  const links = new Map([...document.querySelectorAll('#menu a[href^="#"]')].map(a => [a.getAttribute('href').slice(1), a]));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { links.forEach(a => a.classList.remove('on')); links.get(e.target.id)?.classList.add('on'); } }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }
  // the menu gets a frosted look once the page scrolls
  const menu = $('.menu'); const onScroll = () => menu.classList.toggle('stuck', scrollY > 120); addEventListener('scroll', onScroll, { passive: true }); onScroll();
});
