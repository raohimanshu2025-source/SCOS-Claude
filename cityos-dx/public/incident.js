// Page of one past incident (or the list of all of them): the register row, the reported steps, the news sources and
// the SCOS dependency links the incident supports. Reads only the public /scos/v1 API. The incidents are real events
// from public news reports (52 build incidents of the SCOS research); the links are the SCOS research layer.
'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hi = () => document.documentElement.lang === 'hi';
  // both languages in the page; info.js shows one of them when the language button is pressed
  const L = (en, h) => `<span data-l="en"${hi() ? ' hidden' : ''}>${esc(en)}</span><span data-l="hi" lang="hi"${hi() ? '' : ' hidden'}>${esc(h)}</span>`;
  const get = async u => { const r = await fetch(u, { credentials: 'omit' }); if (!r.ok) throw Object.assign(new Error(String(r.status)), { status: r.status }); return r.json(); };
  const day = d => (/^\d{4}-\d{2}-\d{2}/.test(d) ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(String(d).slice(0, 10) + 'T12:00:00Z')) : d || '');
  const box = () => $('#ip');
  const warn = () => `<p class="warn-box small">${L('From public news reports, summarised with software help and not checked by hand. Open the news source before relying on any detail. Evidence level C1 (news only).', 'सार्वजनिक ख़बरों से, सॉफ़्टवेयर की मदद से सारांशित, हाथ से जाँचा नहीं गया। किसी विवरण पर भरोसा करने से पहले ख़बर खोलें। साक्ष्य स्तर C1 (सिर्फ़ ख़बर)।')}</p>`;

  async function list() {
    const all = await get('/scos/v1/incidents');
    if (!all.length) { box().innerHTML = `<p class="muted">${L('This city has no past incident register.', 'इस शहर में पिछली घटनाओं का रजिस्टर नहीं है।')}</p>`; return; }
    box().innerHTML = `<h1>${L(`All ${all.length} past incidents`, `सभी ${all.length} पिछली घटनाएँ`)}</h1>${warn()}
      <div class="tbl-wrap"><table class="ip-t"><thead><tr><th>${L('Incident', 'घटना')}</th><th>${L('Date', 'तारीख़')}</th><th>${L('Type', 'प्रकार')}</th><th>${L('What happened', 'क्या हुआ')}</th><th>${L('Links', 'कड़ियाँ')}</th></tr></thead>
      <tbody>${all.map(x => `<tr><td><a href="/incident.html?id=${esc(x.incidentId)}">${esc(x.incidentId)}</a></td><td class="nw">${esc(day(x.date))}</td><td>${esc(x.type)}</td><td>${esc(x.summary)}</td><td>${x.links}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function one(id) {
    let d;
    try { d = await get('/scos/v1/incident?id=' + encodeURIComponent(id)); }
    catch (e) { box().innerHTML = `<p class="muted">${e.status === 404 || e.status === 400 ? L(`No incident ${id} in the register.`, `रजिस्टर में ${id} नाम की कोई घटना नहीं।`) : L('The incident could not be loaded.', 'घटना लोड नहीं हो सकी।')}</p><p><a href="/incident.html">${L('All incidents', 'सभी घटनाएँ')}</a></p>`; return; }
    const x = d.incident;
    document.body.dataset.titleEn = `${x.incidentId}: ${x.summary} · City Data Portal (demo)`; document.title = hi() ? document.body.dataset.titleHi : document.body.dataset.titleEn;
    const where = x.placement === 'one' ? L(`On the incident map at the approximate centre of ${x.area} (locality level, not the exact spot).`, `घटना-नक्शे पर ${x.area} के लगभग केंद्र पर (मोहल्ला स्तर, सटीक जगह नहीं)।`)
      : x.placement === 'many' ? L(`The news names many areas, so the incident map shows a hollow ring at the first one (${x.area}), not a single spot. Areas we could place: ${x.areas}.`, `ख़बर कई इलाक़ों का नाम लेती है, इसलिए घटना-नक्शा पहले इलाक़े (${x.area}) पर खोखला घेरा दिखाता है, कोई एक जगह नहीं। जिन इलाक़ों को हम रख पाए: ${x.areas}।`)
      : L('Not on the map: the place named in the news is not in our list of localities.', 'नक्शे पर नहीं: ख़बर में बताई जगह हमारी मोहल्ला-सूची में नहीं है।');
    const nav = `<nav class="ip-nav" aria-label="Incidents">${d.previous ? `<a href="/incident.html?id=${esc(d.previous)}">← ${esc(d.previous)}</a>` : '<span></span>'}<span class="small muted">${d.position} / ${d.total} · <a href="/incident.html">${L('All incidents', 'सभी घटनाएँ')}</a></span>${d.next ? `<a href="/incident.html?id=${esc(d.next)}">${esc(d.next)} →</a>` : '<span></span>'}</nav>`;
    const steps = d.steps.length ? `<ol class="ip-steps">${d.steps.map(s => `<li><span class="ip-n">${s.step}</span><div><p>${esc(s.effect)}</p><p class="small muted">${s.time ? `${L('Time', 'समय')}: ${esc(s.time)}` : L('Time not reported', 'समय नहीं बताया गया')} · ${s.department ? `${L('Department', 'विभाग')}: ${esc(s.department)}` : L('Department not named', 'विभाग का नाम नहीं')}</p></div></li>`).join('')}</ol>`
      : `<p class="muted">${L('No steps recorded.', 'कोई कदम दर्ज नहीं।')}</p>`;
    const links = d.links.length ? `<ul class="sx-list">${d.links.map(l => `<li class="sx-link"><b>${esc(l.linkId)}</b> ${esc(l.fromName)} → ${esc(l.toName)} <span class="small muted">· ${esc(l.type)} · ${L(`seen in ${l.incidents} of the 52 incidents`, `52 में से ${l.incidents} घटनाओं में`)} · ${esc(l.level)}</span>${l.crossBoundary ? ` <span class="badge warn">${L('Hand-over', 'हैंड-ओवर')}: ${esc(l.ownerFrom)} → ${esc(l.ownerTo)}</span>` : l.fromHazard ? ` <span class="badge info">${L('Hazard', 'ख़तरा')}</span>` : ''}</li>`).join('')}</ul>`
      : `<p class="muted">${L('This incident supports no link in the register.', 'यह घटना रजिस्टर की किसी कड़ी का आधार नहीं है।')}</p>`;
    const src = `<div class="tbl-wrap"><table class="ip-t"><thead><tr><th>#</th><th>${L('Publisher', 'प्रकाशक')}</th><th>${L('Date', 'तारीख़')}</th><th>${L('Language', 'भाषा')}</th><th>${L('Headline', 'शीर्षक')}</th><th>${L('Checked by hand', 'हाथ से जाँचा')}</th></tr></thead><tbody>${d.sources.map(s => `<tr><td>${s.sourceNo}</td><td>${esc(s.publisher)}</td><td class="nw">${esc(s.published ? day(s.published) : '—')}</td><td>${esc(s.language)}</td><td><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"${s.language === 'Hindi' ? ' lang="hi"' : ''}>${esc(s.headline || s.url)} ↗</a>${s.openedByFetch !== 'Yes' ? ` <span class="small muted">(${esc(s.openedByFetch)})</span>` : ''}</td><td>${esc(s.checkedByHand)}</td></tr>`).join('')}</tbody></table></div>`;
    box().innerHTML = `${nav}<p class="small muted"><a href="/#deps">${L('Incidents and dependencies', 'घटनाएँ और निर्भरता')}</a> › ${esc(x.incidentId)}</p>
      <h1>${esc(x.summary)}</h1>
      <p class="ip-meta"><span class="badge">${esc(x.incidentId)}</span> <span class="badge">${esc(day(x.date))}</span> <span class="badge">${esc(x.type)}</span> <span class="badge info">${esc(x.evidence)}</span></p>
      ${warn()}
      <div class="ip-grid"><div>
        <h2>${L('Where', 'कहाँ')}</h2><p>${esc(x.place)}</p><p class="small muted">${where}</p>
        <h2>${L('What started it', 'शुरुआत किससे हुई')}</h2><p>${esc(x.trigger)}</p>
        <h2>${L('How it spread, step by step (as reported)', 'यह कैसे फैली, एक-एक कदम (जैसा बताया गया)')}</h2>${steps}
        <h2>${L('Impact', 'असर')}</h2><p>${esc(x.impact)}</p>
        <h2>${L('Departments named in the news', 'ख़बरों में नामित विभाग')}</h2><p>${esc(x.departments)}</p>
      </div><div>
        <section class="ip-scos scos"><p class="sx-tagline"><span class="sx-tag">${L('SCOS layer · research addition', 'SCOS परत · शोध से जोड़ा गया')}</span></p>
          <h2>${L('Dependency links this incident supports', 'यह घटना किन कड़ियों का आधार है')}</h2>
          <p class="small muted">${L(`${d.links.length} ${d.links.length === 1 ? 'link' : 'links'} in the SCOS register ${d.links.length === 1 ? 'cites' : 'cite'} this incident; ${d.handovers} of them ${d.handovers === 1 ? 'passes' : 'pass'} work from one department to another. Coded by one person from the news; not checked by hand.`, `SCOS रजिस्टर की ${d.links.length} कड़ियाँ इस घटना का हवाला देती हैं; इनमें ${d.handovers} एक विभाग से दूसरे विभाग तक काम सौंपती हैं। एक व्यक्ति द्वारा ख़बरों से दर्ज; हाथ से नहीं जाँची गईं।`)}</p>
          ${links}<p class="small"><a href="/#deps">${L('Open the dependency explorer', 'निर्भरता एक्सप्लोरर खोलें')}</a></p></section>
      </div></div>
      <h2>${L(`News sources (${d.sources.length})`, `ख़बरों के स्रोत (${d.sources.length})`)}</h2>${src}
      ${nav}`;
  }

  const start = () => { const id = new URLSearchParams(location.search).get('id'); (id ? one(id.toUpperCase()) : list()).catch(() => { box().innerHTML = `<p class="muted">${L('Could not load.', 'लोड नहीं हो सका।')}</p>`; }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
