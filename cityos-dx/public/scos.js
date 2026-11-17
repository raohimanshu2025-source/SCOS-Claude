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
      play: 'Play', pause: 'Pause', next: 'Next step', back: 'Back', reset: 'Start again', animLabel: 'How the failure spreads, step by step',
      capStart: 'First failure: {s}. Press Play or Next step.', capStep: 'Step {k} of {n}: {list}.', capEnd: 'End of the trace: {a} services reached through {l} links.', capLink: '{f} → {t} ({id}, seen in {c} incidents{h})', capHand: ', hand-over {a} → {b}', actsNow: 'Acts now', key: 'Amber arrow: hand-over between two departments. Grey arrow: same department or a hazard.',
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
      play: 'चलाएँ', pause: 'रोकें', next: 'अगला कदम', back: 'पीछे', reset: 'फिर से शुरू', animLabel: 'विफलता एक-एक कदम कैसे फैलती है',
      capStart: 'पहली विफलता: {s}। चलाएँ या अगला कदम दबाएँ।', capStep: 'कदम {k} / {n}: {list}।', capEnd: 'ट्रेस पूरा: {l} कड़ियों से {a} सेवाएँ प्रभावित।', capLink: '{f} → {t} ({id}, {c} घटनाओं में{h})', capHand: ', हैंड-ओवर {a} → {b}', actsNow: 'अभी काम करे', key: 'नारंगी तीर: दो विभागों के बीच हैंड-ओवर। धूसर तीर: वही विभाग या ख़तरा।',
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
      <div class="sx-anim-bar" role="group" aria-label="${esc(t('animLabel'))}"><button type="button" class="sx-chip" id="sx-play">▶ ${esc(t('play'))}</button><button type="button" class="sx-chip" id="sx-back">◀ ${esc(t('back'))}</button><button type="button" class="sx-chip" id="sx-next">${esc(t('next'))} ▶</button><button type="button" class="sx-chip" id="sx-reset">↺ ${esc(t('reset'))}</button></div>
      <div class="sx-anim">${diagram(tr, byStep)}</div>
      <p class="sx-cap" id="sx-cap" aria-live="polite"></p>
      <p class="small muted">${esc(t('key'))}</p>
      <ol class="sx-steps">${byStep.map((list, k) => `<li class="sx-step" data-k="${k}"><p class="small muted">${esc(k === 0 ? t('start') : t('step', { k }))}</p>${list.map(a => `<div class="sx-node${a.step === 0 ? ' first' : ''}"><b>${esc(a.name)}</b><span class="small">${esc(a.trigger && a.step === 0 && /no owner|IMD/.test(a.owner) ? t('noOwner') : a.owner)}</span>${a.via ? `<span class="small muted">${esc(t('via', { l: a.via }))}</span>` : ''}</div>`).join('')}</li>`).join('')}</ol>
      <h3 class="sub-h">${esc(t('who'))}</h3>
      <ol class="sx-who">${tr.actions.map(a => `<li data-k="${a.step}"><b>${esc(a.department)}</b> <span class="small muted">· ${esc(a.serviceName)}${a.via ? ' · ' + esc(t('via', { l: a.via })) : ''}</span></li>`).join('')}</ol>
      <p class="small muted">${esc(t('whoNote'))}</p>
      <p class="small">${esc(t('basis', { l: tr.links.length, i: tr.incidents.length, x: tr.crossBoundaryLinks }))}</p>`;
    S.maxK = byStep.length - 1; showStep(Math.min(S.k ?? S.maxK, S.maxK));
    $('#sx-play').onclick = () => (S.timer ? stop() : play());
    $('#sx-next').onclick = () => { stop(); showStep(Math.min(S.k + 1, S.maxK)); };
    $('#sx-back').onclick = () => { stop(); showStep(Math.max(S.k - 1, 0)); };
    $('#sx-reset').onclick = () => { stop(); showStep(0); };
  }
  // Step-by-step picture of the trace: one column per step, one box per service, one arrow per link used.
  // Only links from the register are drawn (the same ones the trace API returns); nothing is added.
  function diagram(tr, byStep) {
    const CW = 245, BW = 160, BH = 44, RH = 58, top = 26, pos = new Map();
    byStep.forEach((list, k) => list.forEach((a, i) => pos.set(a.code, { x: 10 + k * CW, y: top + i * RH, a })));
    const W = 10 + byStep.length * CW, H = top + Math.max(...byStep.map(l => l.length)) * RH + 30;
    const into = {};
    const edges = tr.links.map(l => {
      const p = pos.get(l.from), q = pos.get(l.to); if (!p || !q) return '';
      const fwd = q.x > p.x, x1 = fwd ? p.x + BW : p.x + BW / 2, y1 = fwd ? p.y + BH / 2 : p.y + BH, x2 = fwd ? q.x : q.x + BW / 2, y2 = fwd ? q.y + BH / 2 : q.y + BH;
      const d = fwd ? `M${x1},${y1} C${x1 + 22},${y1} ${x2 - 22},${y2} ${x2 - 4},${y2}` : `M${x1},${y1} C${x1},${y1 + 34} ${x2},${y2 + 34} ${x2},${y2 + 4}`;
      const n = (into[l.to] = (into[l.to] || 0) + 1) - 1; // labels of arrows into the same box are stacked, not on top of each other
      const mx = fwd ? x2 - 40 : (x1 + x2) / 2, my = fwd ? y2 - 6 - 12 * n : Math.max(y1, y2) + 22 + 12 * n;
      return `<g class="sx-e${l.crossBoundary ? ' hand' : ''}" data-k="${l.step}"><path d="${d}" marker-end="url(#sx-ah${l.crossBoundary ? 'h' : ''})"><title>${esc(t('capLink', { f: l.fromName, t: l.toName, id: l.linkId, c: l.incidents, h: l.crossBoundary ? t('capHand', { a: l.ownerFrom, b: l.ownerTo }) : '' }))}</title></path><text x="${mx.toFixed(0)}" y="${my.toFixed(0)}" text-anchor="middle">${esc(l.linkId)}</text></g>`;
    }).join('');
    const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    const nodes = [...pos.values()].map(({ x, y, a }) => `<g class="sx-v${a.step === 0 ? ' first' : ''}" data-k="${a.step}"><rect x="${x}" y="${y}" width="${BW}" height="${BH}" rx="9"/><text x="${x + 8}" y="${y + 18}" class="n">${esc(cut(a.name, 22))}</text><text x="${x + 8}" y="${y + 34}" class="o">${esc(cut(a.trigger && a.step === 0 && /no owner|IMD/.test(a.owner) ? t('noOwner') : a.owner || '', 26))}</text><title>${esc(a.name + ' · ' + (a.owner || ''))}</title></g>`).join('');
    const heads = byStep.map((_, k) => `<text class="sx-col-h" data-k="${k}" x="${10 + k * CW}" y="16">${esc(k === 0 ? t('start') : t('step', { k }))}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('animLabel'))}"><defs><marker id="sx-ah" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="sx-ah"/></marker><marker id="sx-ahh" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="sx-ah hand"/></marker></defs>${heads}${edges}${nodes}</svg>`;
  }
  function showStep(k) {
    const box = $('#sx-trace'), tr = S.trace; if (!box || !tr) return; S.k = k;
    box.querySelectorAll('[data-k]').forEach(el => { const s = Number(el.dataset.k); el.classList.toggle('sx-off', s > k); el.classList.toggle('sx-now', s === k); });
    const name = c => tr.affected.find(a => a.code === c)?.name || c;
    const cap = k === 0 ? t('capStart', { s: name(tr.start) })
      : t('capStep', { k, n: S.maxK, list: tr.links.filter(l => l.step === k).map(l => t('capLink', { f: l.fromName, t: l.toName, id: l.linkId, c: l.incidents, h: l.crossBoundary ? t('capHand', { a: l.ownerFrom, b: l.ownerTo }) : '' })).join('; ') })
        + (tr.actions.some(a => a.step === k) ? ' ' + t('actsNow') + ': ' + tr.actions.filter(a => a.step === k).map(a => a.department).join('; ') + '.' : '')
        + (k === S.maxK ? ' ' + t('capEnd', { a: tr.affected.length, l: tr.links.length }) : '');
    $('#sx-cap').textContent = cap;
    $('#sx-back').disabled = k === 0; $('#sx-next').disabled = k === S.maxK;
  }
  function play() { if (S.k >= S.maxK) showStep(0); $('#sx-play').textContent = '❚❚ ' + t('pause'); S.timer = setInterval(() => { if (S.k >= S.maxK) return stop(); showStep(S.k + 1); }, 1800); }
  function stop() { clearInterval(S.timer); S.timer = null; const b = $('#sx-play'); if (b) b.textContent = '▶ ' + t('play'); }
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
  async function loadTrace() { stop(); S.k = 0; const sc = S.about.scenarios.find(s => s.id === S.sc); S.trace = await get('/scos/v1/trace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: sc.start }) }); renderScenario(); }

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
