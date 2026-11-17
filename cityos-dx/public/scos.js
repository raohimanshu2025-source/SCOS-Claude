// SCOS research layer on the public portal (our addition, not part of the two documents): the dependency explorer
// and the three demonstration scenarios. Reads only the public /scos/v1 API. Nothing here is validated, nothing is
// sent to any department, and every link shows its evidence level and the incidents behind it.
'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = async (u, o) => { const r = await fetch(u, { credentials: 'omit', ...o }); if (!r.ok) throw new Error(r.status); return r.json(); };
  const T = {
    en: {
      title: 'How failures spread between city services', tag: 'SCOS layer · research addition',
      lead: 'From the {i} past incidents, we coded which city service failed after which. Pick a service to see what can cause it, what it can affect, which department owns each side, and the news reports behind each link.',
      warn: 'Every link is evidence level C1: seen in news reports, coded by one person, not yet checked by hand or by any department. This is research, not an official map, and nothing here has been validated.',
      stats: '{l} links · {x} cross from one department to another · {h} start from a hazard such as rain',
      pick: 'Pick a city service', strong: 'Only links seen in 2 or more incidents',
      up: 'Can be caused by', down: 'Can affect', owner: 'Owned by', none: 'No link in the register.',
      inc: '{n} incidents', inc1: '1 incident', hand: 'Hand-over', hazard: 'Hazard', ev: 'Evidence', showInc: 'Show the incidents',
      scTitle: 'Three scenarios: what may fail next, and who acts next', scLead: 'Start from a first failure and follow the links step by step. Only links seen in at least 2 past incidents are used. No machine learning and no weights: every step names the link it used.',
      step: 'Step {k}', start: 'First failure', via: 'via {l}', who: 'Who acts next (suggestion only)',
      whoNote: 'A suggestion for the control room. Only the ICCC operator login can approve, hold or reject a task (officer console, screen "SCOS tasks"), and every decision is written to the signed audit log. Nothing is sent to any department.',
      basis: 'Based on {l} links and {i} past incidents; {x} links cross from one department to another.',
      noOwner: 'no owner', err: 'The SCOS layer could not be loaded.', layers: 'Data exchange (BIS 2019) → City intelligence (City OS 2023) → SCOS layer (this research)',
      stTitle: 'What this site is: three layers', stTag: 'SCOS layer · research addition',
      stLead: 'The lower two layers follow two public documents. The top layer is the SCOS research: it adds what happens when one failure causes the next, across departments.',
      stLayers: [
        ['scos', 'SCOS layer (this research, not in the two documents)', 'Which failure spreads to which service, who acts next, an officer approves, every decision is recorded.'],
        ['cos', 'City Intelligence Layer (City OS paper, 2023)', 'Dashboards, alerts from sensors and rules, analytics APIs.'],
        ['bis', 'Data Exchange (BIS draft standard, 2019)', 'Catalogue, consent, access rules and a signed audit trail. Each department stays the owner of its data.'],
      ],
      stIsH: 'SCOS is', stNotH: 'SCOS is not',
      stIs: ['A map of how failures spread between city services, coded from {i} past Kanpur incidents in the news.', 'A list of who acts next, shown to the control room as a suggestion.', 'A record of every approve, hold or reject decision, in the signed audit log.'],
      stNot: ['Not a live system: it is not connected to any department.', 'Not AI or a prediction model: plain rules, and every step names its link.', 'Not an order: nothing is sent to any department.', 'Not validated yet: a sealed-incident test and officer checks are planned.'],
      stGo: 'See how failures spread', stDev: 'For developers',
    },
    hi: {
      title: 'शहर की सेवाओं में विफलता कैसे फैलती है', tag: 'SCOS परत · शोध से जोड़ा गया',
      lead: '{i} पिछली घटनाओं से हमने दर्ज किया कि कौन-सी सेवा किसके बाद विफल हुई। कोई सेवा चुनें और देखें कि उसे क्या प्रभावित कर सकता है, वह किसे प्रभावित कर सकती है, हर हिस्से का ज़िम्मेदार विभाग कौन है, और हर कड़ी के पीछे की ख़बरें।',
      warn: 'हर कड़ी का साक्ष्य स्तर C1 है: ख़बरों में देखा गया, एक व्यक्ति द्वारा दर्ज, अभी हाथ से या किसी विभाग द्वारा जाँचा नहीं गया। यह शोध है, आधिकारिक नक्शा नहीं।',
      stats: '{l} कड़ियाँ · {x} एक विभाग से दूसरे विभाग तक · {h} बारिश जैसे ख़तरे से शुरू',
      pick: 'शहर की सेवा चुनें', strong: 'सिर्फ़ 2 या अधिक घटनाओं में देखी गई कड़ियाँ',
      up: 'इससे हो सकता है', down: 'इसे प्रभावित कर सकता है', owner: 'ज़िम्मेदार', none: 'रजिस्टर में कोई कड़ी नहीं।',
      inc: '{n} घटनाएँ', inc1: '1 घटना', hand: 'हैंड-ओवर', hazard: 'ख़तरा', ev: 'साक्ष्य', showInc: 'घटनाएँ देखें',
      scTitle: 'तीन परिदृश्य: आगे क्या विफल हो सकता है, और आगे कौन काम करे', scLead: 'पहली विफलता से शुरू करके कड़ियों को एक-एक कदम आगे बढ़ाएँ। सिर्फ़ कम से कम 2 पिछली घटनाओं में देखी गई कड़ियाँ। कोई मशीन लर्निंग नहीं।',
      step: 'कदम {k}', start: 'पहली विफलता', via: '{l} से', who: 'आगे कौन काम करे (सिर्फ़ सुझाव)',
      whoNote: 'कंट्रोल रूम के लिए सुझाव। सिर्फ़ ICCC ऑपरेटर लॉगिन किसी काम को मंज़ूर, रोक या अस्वीकार कर सकता है (अधिकारी कंसोल, स्क्रीन "SCOS tasks"), और हर फ़ैसला हस्ताक्षरित ऑडिट लॉग में लिखा जाता है। किसी विभाग को कुछ नहीं भेजा जाता।',
      basis: '{l} कड़ियों और {i} पिछली घटनाओं पर आधारित; {x} कड़ियाँ एक विभाग से दूसरे तक।',
      noOwner: 'कोई ज़िम्मेदार नहीं', err: 'SCOS परत लोड नहीं हो सकी।', layers: 'डेटा एक्सचेंज (BIS 2019) → सिटी इंटेलिजेंस (City OS 2023) → SCOS परत (यह शोध)',
      stTitle: 'यह साइट क्या है: तीन परतें', stTag: 'SCOS परत · शोध से जोड़ा गया',
      stLead: 'नीचे की दो परतें दो सार्वजनिक दस्तावेज़ों पर आधारित हैं। ऊपर की परत SCOS शोध है: यह जोड़ती है कि एक विफलता से अगली विफलता कैसे होती है, विभागों के आर-पार।',
      stLayers: [
        ['scos', 'SCOS परत (यह शोध, दोनों दस्तावेज़ों में नहीं)', 'कौन-सी विफलता किस सेवा तक फैलती है, आगे कौन काम करे, अधिकारी मंज़ूरी दे, हर फ़ैसला दर्ज हो।'],
        ['cos', 'सिटी इंटेलिजेंस लेयर (City OS पेपर, 2023)', 'डैशबोर्ड, सेंसर और नियमों से अलर्ट, एनालिटिक्स API।'],
        ['bis', 'डेटा एक्सचेंज (BIS ड्राफ़्ट मानक, 2019)', 'कैटलॉग, सहमति, पहुँच नियम और हस्ताक्षरित ऑडिट रिकॉर्ड। हर विभाग अपने डेटा का मालिक रहता है।'],
      ],
      stIsH: 'SCOS क्या है', stNotH: 'SCOS क्या नहीं है',
      stIs: ['शहर की सेवाओं के बीच विफलता कैसे फैलती है, इसका नक्शा, कानपुर की {i} पिछली घटनाओं की ख़बरों से।', 'आगे कौन काम करे, इसकी सूची, कंट्रोल रूम के लिए सिर्फ़ सुझाव।', 'हर मंज़ूरी, रोक या अस्वीकृति का रिकॉर्ड, हस्ताक्षरित ऑडिट लॉग में।'],
      stNot: ['चालू प्रणाली नहीं: किसी विभाग से जुड़ा नहीं।', 'AI या भविष्यवाणी मॉडल नहीं: सीधे नियम, हर कदम अपनी कड़ी बताता है।', 'आदेश नहीं: किसी विभाग को कुछ नहीं भेजा जाता।', 'अभी प्रमाणित नहीं: सीलबंद घटनाओं की जाँच और अधिकारियों की जाँच की योजना है।'],
      stGo: 'देखें विफलता कैसे फैलती है', stDev: 'डेवलपर के लिए',
    },
  };
  const lang = () => (document.documentElement.lang === 'hi' ? 'hi' : 'en');
  const raw = k => T[lang()][k] ?? T.en[k];
  const t = (k, v) => { let s = raw(k); if (v) for (const [a, b] of Object.entries(v)) s = s.replace('{' + a + '}', b); return s; };
  const S = { about: null, services: [], svc: 'PWR', strong: false, explore: null, sc: 'S1', trace: null };

  const linkRow = (l, dir) => {
    const other = dir === 'up' ? { code: l.from, name: l.fromName, owner: l.ownerFrom } : { code: l.to, name: l.toName, owner: l.ownerTo };
    const n = l.incidents === 1 ? t('inc1') : t('inc', { n: l.incidents });
    const badge = l.crossBoundary ? `<span class="badge warn" title="${esc(l.ownerFrom)} → ${esc(l.ownerTo)}">${esc(t('hand'))}: ${esc(l.ownerFrom)} → ${esc(l.ownerTo)}</span>` : l.fromHazard ? `<span class="badge info">${esc(t('hazard'))}</span>` : '';
    return `<li class="sx-link"><button type="button" class="sx-go" data-svc="${esc(other.code)}">${esc(other.name)}</button>
      <span class="small muted">${esc(l.linkId)} · ${esc(l.type)} · ${esc(n)} · ${esc(t('ev'))} <b>${esc(l.level)}</b></span> ${badge}
      <details class="sx-inc"><summary class="small">${esc(t('showInc'))}</summary><p class="small">${l.incidentIds.map(id => `<a href="#inc-${esc(id)}" data-inc="${esc(id)}">${esc(id)}</a>`).join(' · ')}</p></details></li>`;
  };
  function renderExplorer() {
    const box = $('#sx-explore'); const e = S.explore; if (!box || !e) return;
    const s = e.service;
    box.innerHTML = `<div class="sx-cols">
      <section class="sx-col" aria-labelledby="sx-up"><h3 id="sx-up" class="sub-h">${esc(t('up'))}</h3>${e.upstream.length ? `<ul class="sx-list">${e.upstream.map(l => linkRow(l, 'up')).join('')}</ul>` : `<p class="muted">${esc(t('none'))}</p>`}</section>
      <section class="sx-col sx-mid" aria-live="polite"><p class="sx-name">${esc(s.name)}</p><p class="small muted">${esc(t('owner'))}</p><p><b>${esc(s.trigger && /no owner/i.test(s.ownerFull) ? t('noOwner') : s.owner)}</b></p><p class="small muted">${esc(s.code)}</p></section>
      <section class="sx-col" aria-labelledby="sx-down"><h3 id="sx-down" class="sub-h">${esc(t('down'))}</h3>${e.downstream.length ? `<ul class="sx-list">${e.downstream.map(l => linkRow(l, 'down')).join('')}</ul>` : `<p class="muted">${esc(t('none'))}</p>`}</section></div>`;
  }
  function renderPicker() {
    const p = $('#sx-pick'); if (!p) return;
    p.innerHTML = S.services.map(s => `<button type="button" class="sx-chip${s.code === S.svc ? ' on' : ''}" data-svc="${esc(s.code)}" aria-pressed="${s.code === S.svc}">${esc(s.name)}</button>`).join('');
  }
  function renderScenario() {
    const box = $('#sx-trace'); const tr = S.trace; if (!box || !tr) return;
    const byStep = []; for (const a of tr.affected) (byStep[a.step] ||= []).push(a);
    $('#sx-sc').innerHTML = (S.about?.scenarios || []).map(s => `<button type="button" class="sx-chip${s.id === S.sc ? ' on' : ''}" data-sc="${esc(s.id)}" aria-pressed="${s.id === S.sc}">${esc(s.id)} · ${esc(s.title)}</button>`).join('');
    const sc = S.about.scenarios.find(s => s.id === S.sc);
    box.innerHTML = `<p class="muted">${esc(sc.why)}</p>
      <ol class="sx-steps">${byStep.map((list, k) => `<li class="sx-step"><p class="small muted">${esc(k === 0 ? t('start') : t('step', { k }))}</p>${list.map(a => `<div class="sx-node${a.step === 0 ? ' first' : ''}"><b>${esc(a.name)}</b><span class="small">${esc(a.trigger && a.step === 0 && /no owner|IMD/.test(a.owner) ? t('noOwner') : a.owner)}</span>${a.via ? `<span class="small muted">${esc(t('via', { l: a.via }))}</span>` : ''}</div>`).join('')}</li>`).join('')}</ol>
      <h3 class="sub-h">${esc(t('who'))}</h3>
      <ol class="sx-who">${tr.actions.map(a => `<li><b>${esc(a.department)}</b> <span class="small muted">· ${esc(a.serviceName)}${a.via ? ' · ' + esc(t('via', { l: a.via })) : ''}</span></li>`).join('')}</ol>
      <p class="small muted">${esc(t('whoNote'))}</p>
      <p class="small">${esc(t('basis', { l: tr.links.length, i: tr.incidents.length, x: tr.crossBoundaryLinks }))}</p>`;
  }
  function renderStatic() {
    const a = S.about; if (!a) return;
    $('#sx-title').textContent = t('title'); $('#sx-tag').textContent = t('tag'); $('#sx-layers').textContent = t('layers');
    $('#sx-lead').textContent = t('lead', { i: a.counts.incidents }); $('#sx-warn').textContent = t('warn');
    $('#sx-stats').textContent = t('stats', { l: a.counts.links, x: a.counts.crossBoundary, h: a.counts.fromHazard });
    $('#sx-pick-l').textContent = t('pick'); $('#sx-strong-l').textContent = t('strong');
    $('#sx-sc-title').textContent = t('scTitle'); $('#sx-sc-lead').textContent = t('scLead');
  }
  function renderStory() {
    const a = S.about, root = $('#story'); if (!a || !root) return;
    const set = (id, k) => { const el = $('#' + id); if (el) el.textContent = t(k); };
    set('st-title', 'stTitle'); set('st-tag', 'stTag'); set('st-lead', 'stLead'); set('st-is-h', 'stIsH'); set('st-not-h', 'stNotH'); set('st-go', 'stGo'); set('st-dev', 'stDev');
    $('#st-stack').innerHTML = raw('stLayers').map(([k, h, d]) => `<li class="st-layer ${k}"><b>${esc(h)}</b><span class="small">${esc(d)}</span></li>`).join('');
    $('#st-is').innerHTML = raw('stIs').map(x => `<li>${esc(x.replace('{i}', a.counts.incidents))}</li>`).join('');
    $('#st-not').innerHTML = raw('stNot').map(x => `<li>${esc(x)}</li>`).join('');
    root.hidden = false;
  }
  const renderAll = () => { renderStory(); renderStatic(); renderPicker(); renderExplorer(); renderScenario(); };

  async function loadExplore() { S.explore = await get(`/scos/v1/explore?service=${encodeURIComponent(S.svc)}&minIncidents=${S.strong ? 2 : 1}`); renderPicker(); renderExplorer(); }
  async function loadTrace() { const sc = S.about.scenarios.find(s => s.id === S.sc); S.trace = await get('/scos/v1/trace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: sc.start }) }); renderScenario(); }

  async function init() {
    const root = $('#deps'); if (!root) return;
    try { S.about = await get('/scos/v1'); } catch { return; }
    if (!S.about.counts.links) return; // this city has no SCOS registers (for example the default demo city)
    root.hidden = false; renderStory();
    S.services = await get('/scos/v1/services');
    renderStatic();
    await Promise.all([loadExplore(), loadTrace()]);
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-svc]'); if (b) { S.svc = b.dataset.svc; loadExplore().catch(() => {}); return; }
      const s = e.target.closest('[data-sc]'); if (s) { S.sc = s.dataset.sc; loadTrace().catch(() => {}); return; }
      const i = e.target.closest('[data-inc]');
      if (i) { const d = document.getElementById('inc-' + i.dataset.inc); if (d) { e.preventDefault(); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
    });
    $('#sx-strong').addEventListener('change', e => { S.strong = e.target.checked; loadExplore().catch(() => {}); });
    new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
