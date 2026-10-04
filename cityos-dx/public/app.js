// Officer web console. Every action is a call to the server's real API with the officer's session.
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const J = o => JSON.stringify(o, null, 2);
let ME = null, CSRF = null, VIEW = 'home';

async function api(method, url, body, headers = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (CSRF && method !== 'GET') h['x-csrf-token'] = CSRF;
  const r = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { ok: r.ok, status: r.status, body: j };
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); }
const pill = (s, cls) => `<span class="pill ${esc(cls || s)}">${esc(s)}</span>`;
const card = (title, body, meets = '') => `<section class="card"><div class="card-h"><h3>${esc(title)}</h3>${meets ? `<div class="meets">${meets.split(' ').map(x => `<span class="chip ${x.startsWith('COS') ? 'cos' : 'bis'}">${x}</span>`).join('')}</div>` : ''}</div>${body}</section>`;
function table(rows, cols) {
  if (!rows || !rows.length) return '<p class="hint">Nothing to show.</p>';
  cols = cols || [...new Set(rows.flatMap(r => Object.keys(r)))];
  return `<div class="tbl-wrap"><table><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${rows.map(r => `<tr>${cols.map(c => { const v = r[c]; return `<td${typeof v === 'string' && v.length > 40 ? ' class="small"' : ''}>${esc(typeof v === 'object' && v !== null ? JSON.stringify(v) : v)}</td>`; }).join('')}</tr>`).join('')}</table></div>`;
}
const out = (el, r) => { el.innerHTML = r.ok ? `<pre class="json">${esc(J(r.body))}</pre>` : `<p class="err">${r.status}: ${esc(r.body.error || r.body)}</p>${r.body.errors ? `<ul class="err">${r.body.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}${r.body.authorizationFlow ? steps(r.body.authorizationFlow) : ''}`; };
const steps = f => `<ol class="steps">${f.map(s => `<li class="${s.ok ? 'ok' : 'bad'}"><b>${s.step}</b><span>${esc(s.text)}</span></li>`).join('')}</ol>`;
function heat(cells) {
  const flat = cells.flat(), mn = Math.min(...flat), mx = Math.max(...flat), n = cells.length;
  const col = v => { const f = (v - mn) / ((mx - mn) || 1); return `hsl(${Math.round(220 - 220 * f)} 70% 50%)`; };
  return `<div class="grid-heat" data-n="${n}">${cells.slice().reverse().flat().map(v => `<div title="${v}" data-c="${col(v)}"></div>`).join('')}</div><p class="hint">North at top. ${mn} to ${mx}.</p>`;
}
// Rows pasted as a JSON list or as CSV with a header line. CSV cells that read as JSON (numbers, objects) are kept as such.
function parseRows(t) {
  t = t.trim(); if (!t) return [];
  if (t.startsWith('[')) return JSON.parse(t);
  const lines = t.split(/\r?\n/).filter(l => l.trim()); const head = lines.shift().split(',').map(h => h.trim());
  const val = v => { v = v.trim(); try { return JSON.parse(v); } catch { return v; } };
  return lines.map(l => { const c = l.split(','); return Object.fromEntries(head.map((h, i) => [h, val(c[i] ?? '')])); });
}
function paintHeat(root) { root.querySelectorAll("[data-n]").forEach(g => { g.style.gridTemplateColumns = `repeat(${g.dataset.n},1fr)`; }); root.querySelectorAll('[data-c]').forEach(d => { d.style.background = d.dataset.c; }); }

const SCREENS = [
  ['home', 'Overview', 'all'],
  ['catalogue', 'Catalogue', 'all'],
  ['access', 'Data access', 'all'],
  ['provider', 'Provider console', 'provider'],
  ['media', 'Camera video', 'all'],
  ['cil', 'City intelligence', 'all'],
  ['iccc', 'ICCC dashboard', 'operator admin auditor'],
  ['calerts', 'Citizen alerts', 'provider operator admin auditor'],
  ['region', 'Sector reports', 'all'],
  ['trust', 'Certificates and trust', 'admin auditor'],
  ['ops', 'Operations and audit', 'admin auditor'],
  ['status', 'Status page', 'all'],
];

async function boot() {
  const r = await api('GET', '/auth/v1/me');
  ME = r.body.principal; CSRF = r.body.csrf;
  if (ME.role === 'anonymous') return loginScreen();
  $('#who').innerHTML = `${esc(r.body.account?.display_name || ME.email)} · ${esc(ME.role)}${ME.cls ? ' · class ' + ME.cls + ' certificate' : ''}<br><button class="btn sm" id="logout">Log out</button>`;
  $('#logout').onclick = async () => { await api('POST', '/auth/v1/logout', {}); location.reload(); };
  if (r.body.account?.must_change) return passwordScreen();
  const nav = $('#nav');
  nav.innerHTML = SCREENS.filter(s => s[2] === 'all' || s[2].split(' ').includes(ME.role)).map(([k, t]) => `<button data-v="${k}"${k === VIEW ? ' aria-current="true"' : ''}>${esc(t)}</button>`).join('');
  nav.onclick = e => { const b = e.target.closest('[data-v]'); if (b) { VIEW = b.dataset.v; nav.querySelectorAll('button').forEach(x => x.removeAttribute('aria-current')); b.setAttribute('aria-current', 'true'); show(); } };
  show();
}
function show() { const m = $('#main'); m.innerHTML = '<p class="muted">Loading…</p>'; (VIEWS[VIEW] || VIEWS.home)(m).catch(e => { m.innerHTML = `<p class="err">${esc(e.message)}</p>`; }); }

function loginScreen() {
  $('#nav').innerHTML = '';
  $('#main').innerHTML = `<div class="login">${card('Officer login', `<form id="lf" class="col"><label class="f">Username<input name="username" autocomplete="username" required></label><label class="f">Password<input name="password" type="password" autocomplete="current-password" required></label><button class="btn primary">Log in</button><p id="le" class="err"></p></form><p class="hint">API clients use their X.509 certificate over TLS instead of a password. The public status page and catalogue search need no login: <a href="/status/v1">status JSON</a>.</p>`)}</div>`;
  $('#lf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const r = await api('POST', '/auth/v1/login', { username: f.get('username'), password: f.get('password') }); if (!r.ok) { $('#le').textContent = r.body.error; return; } location.reload(); };
}
function passwordScreen() {
  $('#main').innerHTML = `<div class="login">${card('Set a new password', `<form id="pf" class="col"><p class="hint">This is your first login. Choose a password of at least 12 characters with letters and digits.</p><label class="f">Current password<input name="old" type="password" required></label><label class="f">New password<input name="new" type="password" minlength="12" required></label><button class="btn primary">Change password</button><p id="pe" class="err"></p></form>`)}</div>`;
  $('#pf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const r = await api('POST', '/auth/v1/password', { old: f.get('old'), new: f.get('new') }); if (!r.ok) { $('#pe').textContent = r.body.error; return; } toast('Password changed. Log in again.'); setTimeout(() => location.reload(), 1200); };
}

const VIEWS = {
  async home(m) {
    const [st, cat] = await Promise.all([api('GET', '/status/v1/heartbeat'), api('GET', '/catalogue/v1/count')]);
    m.innerHTML = `<div class="view"><div class="view-head"><h2>Overview</h2><p>You are signed in as <b>${esc(ME.email || ME.username)}</b> with role <b>${esc(ME.role)}</b>${ME.serial ? ` and certificate <span class="mono">${esc(ME.serial)}</span> (class ${ME.cls})` : ''}. Actions you take here are made with that identity and written to the signed audit log.</p></div>
      <div class="grid3">${card('Catalogue', `<div class="stat"><b>${cat.body.count}</b><span>items</span></div>`, 'BIS-01')}${card('Services', Object.entries(st.body.services).map(([k, v]) => `<div class="row">${pill(v, v === 'up' ? 'up' : 'down')} ${esc(k)}</div>`).join(''), 'BIS-79')}${card('This city', `<p>${esc(st.body.city)}</p><p class="hint">Synthetic demo data. Up for ${st.body.uptimeSec} s.</p>`)}</div></div>`;
  },

  async catalogue(m) {
    m.innerHTML = `<div class="view"><div class="view-head"><h2>Catalogue</h2><p>Search the data exchange catalogue by text, tag, area or time (BIS 4.5.1).</p></div>
      ${card('Search', `<form id="cs" class="row"><input name="q" placeholder="text, e.g. drain"><input name="tag" placeholder="tag, e.g. flood"><select name="type"><option value="">any type</option>${['resourceItem', 'resourceServerGroup', 'resourceServer', 'provider', 'catalogueItem'].map(t => `<option>${t}</option>`).join('')}</select><input name="bbox" placeholder="bbox w,s,e,n"><button class="btn primary">Search</button></form><div id="cr"></div>`, 'BIS-34 BIS-42 BIS-98')}
      ${card('Item', '<div id="ci"><p class="hint">Pick an item from the results.</p></div>', 'BIS-84 BIS-86 BIS-89')}</div>`;
    const run = async () => {
      const f = new FormData($('#cs')); const p = new URLSearchParams();
      if (f.get('q')) p.set('q', f.get('q')); if (f.get('tag')) { p.set('attr', 'tags'); p.set('value', f.get('tag')); } if (f.get('type')) p.set('type', f.get('type')); if (f.get('bbox')) p.set('bbox', f.get('bbox'));
      const r = await api('GET', '/catalogue/v1/search?' + p);
      if (!r.ok) return out($('#cr'), r);
      $('#cr').innerHTML = `<p class="hint">${r.body.total} found</p>` + table(r.body.results.map(i => ({ id: i.id, type: i.itemType.value, name: i.name?.value || i.resourceId?.value, label: i.accessPolicyLabel?.value || '' })));
      $('#cr').querySelectorAll('tr').forEach((tr, k) => { if (k) { tr.style.cursor = 'pointer'; tr.onclick = () => item(r.body.results[k - 1].id); } });
    };
    const item = async id => {
      const r = await api('GET', '/catalogue/v1/items?id=' + encodeURIComponent(id));
      const dm = r.body.refDataModel ? (r.body.refDataModel.value.match(/<catalogue-link>\/(\w+)\//) || [])[1] : null;
      const d = dm ? await api('GET', '/catalogue/v1/datamodels?name=' + dm) : null;
      $('#ci').innerHTML = `<div class="row"><button class="btn sm" id="cw">Notify me of changes</button></div><div class="grid2"><pre class="json">${esc(J(r.body))}</pre>${d ? `<pre class="json">${esc(J(d.body))}</pre>` : ''}</div>`;
      $('#cw').onclick = async () => { const x = await api('POST', '/catalogue/v1/watch', { id }); toast(x.ok ? 'You will be notified of changes' : x.body.error); };
    };
    $('#cs').onsubmit = e => { e.preventDefault(); run(); }; run();
  },

  async access(m) {
    m.innerHTML = `<div class="view"><div class="view-head"><h2>Data access</h2><p>Request an access token, then read data with it. The steps follow BIS Figure 2.</p></div>
      ${card('1. Request a token', `<form id="tf" class="row"><input name="id" class="grow" placeholder="item id, e.g. urn:demo-cat:drains/drain-1" required><input name="purpose" placeholder="purpose"><button class="btn primary">Request token</button></form><div id="to"></div>`, 'BIS-35 BIS-58 BIS-63')}
      ${card('2. Read data', `<form id="rf" class="col"><div class="row"><input name="id" class="grow" placeholder="item id" required><select name="op">${['latest', 'search', 'count', 'status', 'download'].map(o => `<option>${o}</option>`).join('')}</select></div><div class="row"><input name="token" class="grow" placeholder="token (blank for public items)"><input name="extra" placeholder="extra query, e.g. attr=level&op=gt&value=1"></div><button class="btn primary">Send</button></form><div id="ro"></div>`, 'BIS-36 BIS-55 BIS-99')}
      <div class="grid2">${card('My tokens', '<div id="mt"></div>', 'BIS-35')}${card('My consent requests', '<div id="mc"></div>', 'BIS-81')}</div>
      ${card('Inbox', '<div id="ib"></div>', 'BIS-29 BIS-80')}</div>`;
    const lists = async () => {
      if (!ME.email) { $('#mt').innerHTML = $('#mc').innerHTML = $('#ib').innerHTML = '<p class="hint">Your account has no certificate, so you can only read public items.</p>'; return; }
      const [t, c, i] = await Promise.all([api('GET', '/auth/v1/token/list'), api('GET', '/auth/v1/consent?role=consumer'), api('GET', '/notify/v1/history')]);
      $('#mt').innerHTML = t.ok ? table(t.body.map(x => ({ token: '…' + x.tail, items: x.items.join(', '), status: x.status, expiry: x.expiry, accesses: x.accesses }))) : '<p class="hint">Needs an identity.</p>';
      $('#mc').innerHTML = c.ok ? table(c.body.map(x => ({ id: x.id, item: x.item_id, status: x.status, purpose: x.purpose, 'consent artefact': x.artefact ? `${x.artefact.id} (${x.artefact.status}, until ${x.artefact.validTo.slice(0, 10)})` : '' }))) + (c.body.some(x => x.artefact) ? '<p class="hint">Consent artefacts are signed by the data exchange (BIS 4.1, MeitY consent framework layout). Open one with GET /auth/v1/consent/artefact?id=…</p>' : '') : '';
      $('#ib').innerHTML = i.ok ? table(i.body.map(x => ({ when: x.created_at, message: x.msg }))) : '';
    };
    $('#tf').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const r = await api('POST', '/auth/v1/token', { request: [{ id: f.get('id').trim() }], purpose: f.get('purpose') });
      if (r.ok) { $('#to').innerHTML = `<p class="okt">Token granted (${esc(r.body.via.map(v => v.via).join(', '))}), expires ${esc(r.body.expiry)}.</p><pre class="json">${esc(r.body.token)}</pre>`; $('#rf').id.value = f.get('id').trim(); $('#rf').token.value = r.body.token; }
      else out($('#to'), r);
      lists();
    };
    $('#rf').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const r = await api('GET', `/resource/v1/${f.get('op')}?id=${encodeURIComponent(f.get('id').trim())}&trace=1${f.get('extra') ? '&' + f.get('extra') : ''}`, undefined, f.get('token') ? { token: f.get('token').trim() } : {});
      if (r.ok && r.body.authorizationFlow) { const { authorizationFlow, ...rest } = r.body; $('#ro').innerHTML = steps(authorizationFlow) + `<pre class="json">${esc(J(rest))}</pre>`; } else out($('#ro'), r);
      lists();
    };
    lists();
  },

  async provider(m) {
    m.innerHTML = `<div class="view"><div class="view-head"><h2>Provider console</h2><p>Consent requests, policies P = (C, A), licences and the list of consent and data flows (BIS 5.3, 5.4, 5.6).</p></div>
      ${card('Consent requests', '<div id="pc"></div>', 'BIS-14 BIS-30 BIS-68')}
      ${card('Policy of an item', `<form id="pf" class="row"><input name="id" class="grow" placeholder="item id you own" required><button class="btn">Load</button></form><div id="po"></div>`, 'BIS-70 BIS-71 BIS-72 BIS-66')}
      ${card('Licence agreement with an app developer', `<form id="lf" class="col"><div class="row"><input name="id" placeholder="item id" required><input name="app" placeholder="app name" required><input name="developer" placeholder="developer e-mail" required></div><input name="terms" placeholder="terms" required><button class="btn">Record licence</button></form><div id="lo"></div>`, 'BIS-32')}
      ${card('Revoke a consumer', `<form id="vf" class="row"><input name="id" placeholder="item id" required><input name="consumer" placeholder="consumer e-mail" required><button class="btn danger">Revoke access</button></form><div id="vo"></div>`, 'BIS-100')}
      ${card('All consent and data flows', '<div id="pfl"></div>', 'BIS-80')}
      ${card("Your department's datasets", `<div id="dm"></div>
        <details id="dprov"><summary>1. Provider entry for your department</summary><form id="dpf" class="col"><input name="name" placeholder="department name, e.g. Kanpur Jal Sansthan" required><input name="description" placeholder="what data you provide" required><input name="url" placeholder="website (optional)"><button class="btn">Create provider entry</button></form></details>
        <details><summary>2. Add a dataset group (one data model, one resource server)</summary><form id="dgf" class="col"><input name="name" placeholder="group name, e.g. Pumping stations" required><input name="description" placeholder="description" required><input name="tags" placeholder="tags, comma separated"><div class="row"><label class="f">Data model<select name="model" id="dgm"></select></label><label class="f">Resource server<select name="resourceServer" id="dgr"></select></label><label class="f">Access object<select name="accessObjectType"><option>openAPI</option><option>asyncAPI</option><option>custom</option></select></label></div><button class="btn">Add group</button></form></details>
        <details><summary>3. Add a dataset to a group</summary><form id="ddf" class="col"><div class="row"><label class="f">Group<select name="group" id="ddg"></select></label><label class="f">Access label<select name="label"><option>public</option><option>protected</option><option>private</option><option>confidential</option></select></label><label class="f">Type<select name="resourceType"><option>messageStream</option><option>table</option><option>file</option></select></label></div><input name="name" placeholder="dataset name, e.g. Pump station 4" required><input name="description" placeholder="description" required><input name="tags" placeholder="tags, comma separated"><div class="row"><input name="lon" placeholder="longitude (optional)"><input name="lat" placeholder="latitude (optional)"></div><button class="btn">Add dataset</button></form></details>
        <details><summary>4. Add data to a dataset</summary><form id="dif" class="col"><div class="row"><label class="f">Dataset<select name="id" id="dii"></select></label><label class="f">Tables<select name="mode"><option value="append">add rows</option><option value="replace">replace all rows</option></select></label></div><div id="dcols" class="hint"></div><div id="onerow"></div><p class="hint">Or many rows at once: choose a CSV file (first line = column names; use <b>lon</b> and <b>lat</b> columns for a location), or paste CSV or a JSON list below.</p><div class="row"><input type="file" id="dfile" accept=".csv,.json,text/csv,application/json"><a href="#" id="dtpl" class="btn sm">Download a CSV template</a></div><textarea name="rows" rows="6" placeholder="CSV with a header line, or a JSON list. Column names must match the data model."></textarea><button class="btn">Add rows</button></form></details>
        <div id="dout"></div>`)}</div>`;
    const load = async () => {
      const [c, f] = await Promise.all([api('GET', '/auth/v1/consent'), api('GET', '/auth/v1/flows')]);
      $('#pc').innerHTML = c.body.length ? c.body.map(x => `<div class="inbox-item"><div class="row">${pill(x.status, x.status === 'pending' ? 'pending' : x.status === 'approved' ? 'ok' : 'bad')}<b>${esc(x.id)}</b> ${esc(x.consumer)} (class ${x.cls}) asks for <span class="mono">${esc(x.item_id)}</span></div><div class="hint">Purpose: ${esc(x.purpose)} · ${esc(x.created_at)}</div>${x.artefact ? `<div class="hint">Consent artefact ${esc(x.artefact.id)}: ${esc(x.artefact.status)} until ${esc(x.artefact.validTo.slice(0, 10))}</div>` : ''}${x.status === 'pending' ? `<div class="row"><select class="sm" data-days="${esc(x.id)}" aria-label="Consent valid for">${[30, 90, 180, 365].map(d => `<option value="${d}"${d === 90 ? ' selected' : ''}>valid ${d} days</option>`).join('')}</select><select class="sm" data-acc="${esc(x.id)}" aria-label="Permission">${['VIEW', 'QUERY', 'STREAM', 'STORE'].map(a => `<option>${a}</option>`).join('')}</select><button class="btn sm primary" data-a="${esc(x.id)}">Approve</button><button class="btn sm danger" data-r="${esc(x.id)}">Reject</button></div>` : ''}</div>`).join('') : '<p class="hint">No consent requests.</p>';
      $('#pfl').innerHTML = f.ok ? table(f.body.dataFlows.map(x => ({ token: '…' + x.tail, consumer: x.consumer, items: x.items.join(', '), via: x.via, status: x.status, accesses: x.accesses, last: x.last_access }))) : out($('#pfl'), f) || '';
    };
    $('#pc').onclick = async e => { const a = e.target.dataset.a, r = e.target.dataset.r; if (!a && !r) return; const id = a || r; const x = await api('POST', '/auth/v1/consent/decide', { id, approve: !!a, validDays: Number($(`[data-days="${id}"]`)?.value || 90), access: $(`[data-acc="${id}"]`)?.value || 'VIEW' }); toast(x.ok ? 'Decision recorded' : x.body.error); load(); };
    $('#pf').onsubmit = async e => {
      e.preventDefault(); const id = new FormData(e.target).get('id').trim(); const r = await api('GET', '/auth/v1/acl?id=' + encodeURIComponent(id)); if (!r.ok) return out($('#po'), r);
      const voc = (await api('GET', '/catalogue/v1/policy-vocabulary')).body;
      $('#po').innerHTML = `<p class="mono small">${esc(r.body.text)}</p><form id="pe" class="col"><label class="f">Label<select name="label">${['public', 'protected', 'private', 'confidential'].map(l => `<option${l === r.body.label ? ' selected' : ''}>${l}</option>`).join('')}</select></label><label class="f">C: consumers allowed (one e-mail per line)<textarea name="C" rows="4">${esc(r.body.C.join('\n'))}</textarea></label>${Object.entries(voc.table3).map(([k, vals]) => `<label class="f">${esc(voc.table3Names[k])}<select name="A_${k}">${[...new Set([voc.table4[r.body.label][k], ...vals])].map(v => `<option${r.body.A[k] === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`).join('')}<p class="hint">Table 4 (${esc(r.body.label)}): consent ${esc(voc.table4[r.body.label].consent)}; data monetization ${esc(voc.table4[r.body.label].dataMonetization)}. Nature of data: ${esc(voc.table4[r.body.label].natureOfData)}.</p><button class="btn primary">Save policy</button></form><div id="pr"></div>`;
      $('#pe').onsubmit = async ev => { ev.preventDefault(); const g = new FormData(ev.target); const A = {}; for (const k of Object.keys(voc.table3)) A[k] = g.get('A_' + k); const lab = g.get('label'); const x = await api('PUT', '/auth/v1/acl?id=' + encodeURIComponent(id), lab !== r.body.label ? { label: lab, C: g.get('C').split('\n').map(s => s.trim()).filter(Boolean) } : { C: g.get('C').split('\n').map(s => s.trim()).filter(Boolean), A }); out($('#pr'), x); };
    };
    $('#lf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); out($('#lo'), await api('POST', '/auth/v1/licence', f)); };
    $('#vf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); out($('#vo'), await api('POST', '/auth/v1/token/revoke', f)); load(); };
    const mine = async () => {
      const [mi, dms, rss] = await Promise.all([api('GET', '/catalogue/v1/mine'), api('GET', '/catalogue/v1/datamodels'), api('GET', '/resource/v1/servers')]);
      if (!mi.ok) { $('#dm').innerHTML = `<p class="hint">${esc(mi.body.error)}</p>`; return; }
      $('#dm').innerHTML = table(mi.body);
      $('#dprov').hidden = mi.body.some(i => i.type === 'provider');
      const opts = (list, f) => list.map(x => `<option value="${esc(f(x)[0])}">${esc(f(x)[1])}</option>`).join('');
      $('#dgm').innerHTML = opts(dms.body, x => [x, x]); $('#dgr').innerHTML = opts(rss.body, x => [x.id, x.id]);
      $('#ddg').innerHTML = opts(mi.body.filter(i => i.type === 'resourceServerGroup'), x => [x.id, x.name]);
      $('#dii').innerHTML = opts(mi.body.filter(i => i.type === 'resourceItem'), x => [x.id, x.name + ' (' + x.id + ')']);
      showFields();
    };
    const add = type => async e => { e.preventDefault(); const r = await api('POST', '/catalogue/v1/items/simple', { type, ...Object.fromEntries(new FormData(e.target)) }); out($('#dout'), r); if (r.ok) { toast('Added to the catalogue'); e.target.reset(); mine(); } };
    $('#dpf').onsubmit = add('provider'); $('#dgf').onsubmit = add('group'); $('#ddf').onsubmit = add('dataset');
    // Data entry helpers: show the dataset's columns, a one-row form built from its data model, a CSV template and file upload.
    let FIELDS = [];
    const modelFields = async id => {
      const it = await api('GET', '/catalogue/v1/items?id=' + encodeURIComponent(id)); if (!it.ok) return [];
      const name = String(it.body.refDataModel?.value || '').split('/').filter(Boolean).slice(-2, -1)[0];
      const dm = await api('GET', '/catalogue/v1/datamodels?name=' + encodeURIComponent(name || '')); if (!dm.ok) return [];
      return Object.entries(dm.body.properties || {}).map(([k, v]) => ({ k, type: String(v.$ref || '').split('/').pop(), unit: v.unitText || '', min: v.minValue, max: v.maxValue }));
    };
    const toPacket = row => { // lon/lat columns become the GeoJSON point the data model asks for; numbers stay numbers
      const geo = FIELDS.find(f => f.type === 'GeoProperty'); const pk = {};
      for (const [k, v] of Object.entries(row)) { if (v === '' || v == null || ['lon', 'lat', 'longitude', 'latitude'].includes(k)) continue; const f = FIELDS.find(x => x.k === k); pk[k] = f?.type === 'QuantitativeProperty' ? Number(v) : f?.type === 'TimeProperty' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(v).toISOString() : v; }
      const lon = row.lon ?? row.longitude, lat = row.lat ?? row.latitude;
      if (geo && lon !== undefined && lat !== undefined && lon !== '' && lat !== '') pk[geo.k] = { type: 'Point', coordinates: [Number(lon), Number(lat)] };
      return pk;
    };
    const showFields = async () => {
      const id = $('#dii').value; FIELDS = id ? await modelFields(id) : [];
      if (!FIELDS.length) { $('#dcols').innerHTML = ''; $('#onerow').innerHTML = ''; return; }
      $('#dcols').innerHTML = 'Columns for this dataset: ' + FIELDS.map(f => `<b>${esc(f.k)}</b>${f.unit ? ' (' + esc(f.unit) + (f.min != null ? ', ' + f.min + ' to ' + f.max : '') + ')' : f.type === 'TimeProperty' ? ' (date or date-time)' : f.type === 'GeoProperty' ? ' (lon, lat)' : ''}`).join(', ');
      const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
      $('#onerow').innerHTML = `<fieldset class="col"><legend>Add one row</legend><div class="grid2">${FIELDS.map(f => f.type === 'GeoProperty'
        ? `<label class="f">${esc(f.k)} longitude<input data-k="lon" inputmode="decimal"></label><label class="f">${esc(f.k)} latitude<input data-k="lat" inputmode="decimal"></label>`
        : `<label class="f">${esc(f.k)}${f.unit ? ' (' + esc(f.unit) + ')' : ''}<input data-k="${esc(f.k)}" ${f.type === 'QuantitativeProperty' ? `type="number" step="any"${f.min != null ? ` min="${f.min}" max="${f.max}"` : ''}` : f.type === 'TimeProperty' ? (/date$/i.test(f.k) ? `type="date" value="${now.slice(0, 10)}"` : `type="datetime-local" value="${now}"`) : ''}></label>`).join('')}</div><button type="button" class="btn primary" id="onebtn">Save this row</button></fieldset>`;
      $('#onerow').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#onebtn').click(); } };
      $('#onebtn').onclick = async () => {
        const row = {}; $('#onerow').querySelectorAll('[data-k]').forEach(i => { row[i.dataset.k] = i.value.trim(); });
        const r = await api('POST', '/resource/v1/ingest', { id: $('#dii').value, mode: 'append', data: [toPacket(row)] }); out($('#dout'), r);
        if (r.ok) toast('Row saved. Public datasets show it on the home page within a minute.');
      };
    };
    $('#dii').onchange = showFields;
    $('#dtpl').onclick = e => { e.preventDefault(); if (!FIELDS.length) return toast('Choose a dataset first');
      const head = FIELDS.flatMap(f => (f.type === 'GeoProperty' ? ['lon', 'lat'] : [f.k]));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([head.join(',') + '\n'], { type: 'text/csv' })); a.download = ($('#dii').value.split('/').pop() || 'dataset') + '-template.csv'; a.click(); };
    $('#dfile').onchange = async e => { const f = e.target.files[0]; if (f) { $('#dif').elements.rows.value = await f.text(); toast(`Read ${f.name}. Check the rows, then click Add rows.`); } };
    $('#dif').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); let data; try { data = parseRows(f.get('rows')).map(toPacket); } catch (x) { return toast('Could not read the rows: ' + x.message); } const r = await api('POST', '/resource/v1/ingest', { id: f.get('id'), mode: f.get('mode'), data }); out($('#dout'), r); if (r.ok) toast(`${data.length} row(s) saved.`); };
    load(); mine();
  },

  async cil(m) {
    const apis = (await api('GET', '/cil/v1/apis')).body;
    m.innerHTML = `<div class="view"><div class="view-head"><h2>City intelligence</h2><p>Domain APIs of the City Intelligence Layer (City OS Sections 3 and 4). Inputs are read only through the data exchange; protected inputs need your data exchange access.</p></div>
      ${card('Call an API', `<form id="af" class="col"><select name="path">${apis.map(a => `<option value="${esc(a.path)}">${esc(a.domain)} · ${esc(a.name)} (${esc(a.path)})</option>`).join('')}</select><label class="f">Request body (JSON, blank for defaults)<textarea name="body" rows="3">{}</textarea></label><div class="row"><button class="btn primary">Call</button><button class="btn" type="button" id="ao">Show OpenAPI</button></div></form><div id="ar"></div>`, 'COS-16 COS-17 COS-18 COS-19 COS-20 COS-21 COS-22')}
      <div class="grid2">${card('Ask a question', `<form id="qf" class="row"><input name="q" class="grow" value="Which drains are near overflow?"><button class="btn primary">Ask</button></form><div id="qo"></div><p class="hint">Keyword matching onto the APIs. Not a language model.</p>`, 'COS-29')}
      ${card('OLAP', `<form id="of" class="row"><select name="measure"><option value="griev">grievances</option><option value="waste">waste tonnes</option><option value="alerts">alerts</option></select><select name="rows"><option>ward</option><option>day</option><option>cat</option></select><select name="cols"><option>cat</option><option>ward</option><option>day</option></select><button class="btn">Pivot</button></form><div id="oo"></div>`, 'COS-31')}</div>
      ${card('Plug in an analytic', `<form id="rf" class="col"><p class="hint">Give the full specification (City OS Figure 13). Inputs are checked against the ontology and the catalogue's data models.</p><textarea name="spec" rows="10">${esc(J({ id: 'pm-ward', domain: 'Air Quality', name: 'Average PM2.5 by ward', path: '/environment/pmByWard', inputs: [{ group: 'aqm', type: 'Time Series', role: 'RequiresDataSource', attr: 'PM2_5' }], out: 'Table', viz: 'Bar', period: 15, dataPeriodicity: '15 min', procedure: 'Mean of the latest PM2.5 of the sensors in each ward', provenance: 'Your organisation', operation: 'meanByWard', alertAbove: 80 }))}</textarea><button class="btn primary">Register</button></form><div id="rr"></div>`, 'COS-28 COS-32 COS-33')}
      ${card('Federation', `<form id="ff" class="row"><select name="path"><option>/publictransit/fleetPerformance</option>${apis.map(a => `<option>${esc(a.path)}</option>`).join('')}</select><button class="btn">Ask all cities</button></form><div id="fo"></div>`, 'COS-08 COS-15 COS-34')}</div>`;
    $('#af').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target); let b = {}; try { b = JSON.parse(f.get('body') || '{}'); } catch { return toast('Body is not valid JSON'); }
      const r = await api('POST', '/cil/v1' + f.get('path'), b);
      if (!r.ok) return out($('#ar'), r);
      const o = r.body.output;
      $('#ar').innerHTML = (o.cells ? heat(o.cells) : '') + (o.rows ? table(o.rows) : '') + (o.type === 'SingleStat' ? `<div class="stat"><b>${esc(o.value ?? '—')} ${esc(o.unit)}</b><span>${esc(o.stop)} · ${esc(o.bus)}</span></div>` : '') + `<details><summary>Full response</summary><pre class="json">${esc(J(r.body))}</pre></details>`;
      paintHeat($('#ar'));
    };
    $('#ao').onclick = async () => out($('#ar'), await api('GET', '/cil/v1/openapi?path=' + encodeURIComponent($('#af').path.value)));
    $('#qf').onsubmit = async e => { e.preventDefault(); const r = await api('POST', '/cil/v1/ask', { question: new FormData(e.target).get('q') }); $('#qo').innerHTML = r.ok ? `<p><b>${esc(r.body.answer)}</b></p>${r.body.api ? `<p class="hint">Answered by POST /cil/v1${esc(r.body.api)}</p>` : ''}` : `<p class="err">${esc(r.body.error)}</p>`; };
    $('#of').onsubmit = async e => { e.preventDefault(); const r = await api('POST', '/cil/v1/olap', Object.fromEntries(new FormData(e.target))); if (!r.ok) return out($('#oo'), r); $('#oo').innerHTML = table(r.body.rows.map((rw, i) => ({ [r.body.measure]: rw, ...Object.fromEntries(r.body.cols.map((c, j) => [c, r.body.cells[i][j]])) }))); };
    $('#rf').onsubmit = async e => { e.preventDefault(); let s; try { s = JSON.parse(new FormData(e.target).get('spec')); } catch { return toast('Specification is not valid JSON'); } out($('#rr'), await api('POST', '/cil/v1/analytics', s)); };
    $('#ff').onsubmit = async e => { e.preventDefault(); const r = await api('POST', '/cil/v1/federate', { path: new FormData(e.target).get('path') }); if (!r.ok) return out($('#fo'), r); $('#fo').innerHTML = table(r.body.cities.map(c => ({ city: c.city, answered: c.ok, error: c.error || '' }))) + `<pre class="json">${esc(J(r.body.aggregate))}</pre>`; };
  },

  async iccc(m) {
    const [al, rep] = await Promise.all([api('GET', '/cil/v1/alerts'), api('GET', '/cil/v1/report')]);
    m.innerHTML = `<div class="view"><div class="view-head"><h2>ICCC dashboard</h2><p>Alerts raised by analytics and the monthly report on system performance (City OS Section 4).</p></div>
      ${card('Latest alerts', table(al.body.slice(0, 30).map(a => ({ time: a.ts, domain: a.domain, ward: a.ward, alert: a.msg, source: a.source }))), 'COS-28 COS-30')}
      ${card('Monthly report ' + (rep.body.month || ''), rep.ok ? `<h4>API use</h4>${table(rep.body.apiUse)}<h4>Alerts by domain</h4>${table(rep.body.alertsByDomain)}<h4>Uptime</h4>${table(rep.body.uptime)}` : `<p class="err">${esc(rep.body.error)}</p>`, 'COS-30')}</div>`;
  },

  // Citizen alerts (our addition): an officer drafts, a different control room officer approves; only approved alerts reach the public portal.
  async calerts(m) {
    const r = await api('GET', '/cil/v1/citizen-alerts/all');
    const canDraft = ['provider', 'operator', 'admin'].includes(ME.role), canDecide = ['operator', 'admin'].includes(ME.role);
    const me = ME.email || ME.username;
    const rows = r.ok ? r.body : [];
    const st = a => a.status === 'approved' && !a.live ? 'expired' : a.status;
    const cls = { pending: 'pending', approved: 'ok', refused: 'bad', withdrawn: 'muted', expired: 'muted' };
    const actions = a => {
      const b = [];
      if (a.status === 'pending' && canDecide && a.drafted_by !== me) b.push(`<button class="btn primary sm" data-act="approve" data-id="${a.id}">Approve</button><button class="btn danger sm" data-act="refuse" data-id="${a.id}">Refuse</button>`);
      if (a.status === 'pending' && canDecide && a.drafted_by === me) b.push('<span class="hint">Needs another officer</span>');
      if (['pending', 'approved'].includes(a.status) && (canDecide || a.drafted_by === me) && st(a) !== 'expired') b.push(`<button class="btn sm" data-act="withdraw" data-id="${a.id}">Withdraw</button>`);
      return b.join(' ');
    };
    const list = rows.length ? `<div class="tbl-wrap"><table><tr><th>#</th><th>Status</th><th>Alert</th><th>Area</th><th>Written by</th><th>Decided by</th><th></th></tr>${rows.map(a => `<tr><td>${a.id}</td><td>${pill(st(a), cls[st(a)])}</td><td><b>${esc(a.level)} · ${esc(a.kind)}: ${esc(a.title)}</b><br><span class="small">${esc(a.message)}</span>${a.note ? `<br><span class="hint">Note: ${esc(a.note)}</span>` : ''}</td><td>${esc(a.area)}<br><span class="hint">${esc(a.department)}</span></td><td class="small">${esc(a.drafted_by)}<br>${esc(a.drafted_at)}</td><td class="small">${esc(a.decided_by || '')}<br>${esc(a.decided_at || '')}${a.expires_at ? `<br>until ${esc(a.expires_at)}` : ''}</td><td>${actions(a)}</td></tr>`).join('')}</table></div>` : '<p class="hint">No alerts yet.</p>';
    const opt = xs => xs.map(x => `<option>${x}</option>`).join('');
    m.innerHTML = `<div class="view"><div class="view-head"><h2>Citizen alerts</h2><p>An officer writes an alert; a <b>different</b> control room officer approves it before it appears on the public portal (two-person rule). Alerts are shown on the portal only: no SMS, e-mail or app message is sent. Every step is written to the signed audit log. This screen is our addition; the two documents do not ask for it.</p></div>
      ${canDraft ? card('Write an alert', `<form id="caf" class="col">
        <div class="row"><label class="f">Kind<select name="kind">${opt(['flood', 'water', 'power', 'traffic', 'health', 'fire', 'air', 'other'])}</select></label><label class="f">Level<select name="level">${opt(['info', 'advisory', 'warning'])}</select></label><label class="f">Area<input name="area" placeholder="e.g. Zone 6" required></label><label class="f">Show for (hours)<input name="hours" type="number" min="1" max="720" value="24" required></label></div>
        <input name="title" maxlength="120" placeholder="Title (English)" required><textarea name="message" maxlength="600" rows="2" placeholder="Message (English): what is happening and what people should do" required></textarea>
        <input name="titleHi" maxlength="120" placeholder="Title in Hindi (optional)" lang="hi"><textarea name="messageHi" maxlength="600" rows="2" placeholder="Message in Hindi (optional)" lang="hi"></textarea>
        <button class="btn primary">Send for approval</button></form><div id="cao"></div>`) : ''}
      ${card('All alerts', r.ok ? list : `<p class="err">${esc(r.body.error)}</p>`)}</div>`;
    if (canDraft) $('#caf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.hours = Number(f.hours); const x = await api('POST', '/cil/v1/citizen-alerts', f); if (!x.ok) return out($('#cao'), x); toast('Sent for approval. Another control room officer must approve it.'); show(); };
    m.querySelectorAll('[data-act]').forEach(b => { b.onclick = async () => {
      const id = Number(b.dataset.id), act = b.dataset.act;
      let x;
      if (act === 'withdraw') { if (!confirm('Withdraw alert #' + id + '? It will disappear from the portal.')) return; x = await api('POST', '/cil/v1/citizen-alerts/withdraw', { id }); }
      else { const note = prompt(act === 'approve' ? 'Optional note for the record (what you checked):' : 'Reason for refusing:') ; if (note === null) return; x = await api('POST', '/cil/v1/citizen-alerts/decide', { id, approve: act === 'approve', note }); }
      toast(x.ok ? (act === 'approve' ? 'Approved. It is now on the public portal.' : act === 'refuse' ? 'Refused.' : 'Withdrawn.') : x.body.error); show();
    }; });
  },

  // BIS 4.5.2.1: live and archived playback of media streams, pause and stop, and download of media files.
  // State-level and sector-wise reports (City OS Sections 1 and 4) and the central access rules.
  async region(m) {
    const [r, cp] = await Promise.all([api('GET', '/cil/v1/reports/region'), api('GET', '/ops/v1/central-policy')]);
    if (!r.ok) { m.innerHTML = `<p class="err">${esc(r.body.error || 'not available')}</p>`; return; }
    const d = r.body, multi = d.members.length > 1 || d.level !== 'city';
    const fmt = v => (v === null || v === undefined ? '–' : esc(String(v)));
    const sector = s => card(s.sector, `<div class="tbl-wrap"><table><tr><th>Figure</th><th>${multi ? esc(d.name) + ' (' + (s.kpis[0]?.combine === 'sum' ? 'total' : 'combined') + ')' : 'Value'}</th>${multi ? d.members.filter(x => x.ok).map(x => `<th>${esc(x.name)}</th>`).join('') : ''}<th>Better</th></tr>${s.kpis.map(k => `<tr><td>${esc(k.kpi)} <span class="hint">${esc(k.unit)}${multi ? ', ' + esc(k.combine) : ''}</span></td><td><b>${fmt(k.value)}</b></td>${multi ? k.perMember.map(x => `<td>${fmt(x.value)}${x.name === k.best ? ' ' + pill('best', 'ok') : x.name === k.worst ? ' ' + pill('lowest', 'bad') : ''}</td>`).join('') : ''}<td>${esc(k.better)}</td></tr>`).join('')}</table></div>`);
    const members = d.members.map(x => `<li>${pill(x.ok ? 'answered' : 'no answer', x.ok ? 'ok' : 'bad')} <b>${esc(x.name)}</b> ${esc(x.level || '')} <span class="hint">${esc(x.ok ? x.via + ', ' + (x.observed || '') : x.error)}</span></li>`).join('');
    const rules = cp.ok && (cp.body.applied || cp.body.published);
    m.innerHTML = `<div class="view"><div class="view-head"><h2>Sector reports: ${esc(d.name)} (${esc(d.level)} level)</h2><p>Sector-wise performance figures computed by each city's City Intelligence Layer from its own data exchange. A state node reads each city's figures through that city's data exchange; a national node reads the state reports. ${esc(d.note)}</p></div>
      ${card('Who is in this report', `<ul class="plain">${members}</ul>`, 'COS-08')}
      <div class="grid2">${d.sectors.map(sector).join('')}</div>
      ${card('Central access rules', rules ? `<pre class="json">${esc(JSON.stringify(rules, null, 1))}</pre><p class="hint">Set at state or national level; they can only narrow access in a city.</p>` : '<p class="hint">No state or national rules apply to this node.</p>', 'COS-08')}</div>`;
  },
  async media(m) {
    const cat = await api('GET', '/catalogue/v1/search?limit=500');
    const cams = (cat.body.results || []).filter(d => d.resourceType?.value === 'mediaStream');
    m.innerHTML = `<div class="view"><div class="view-head"><h2>Camera video</h2><p>Live and archived playback of a camera, with pause and stop, and download of single pictures (BIS 4.5.2.1). The pictures are synthetic; no real camera is connected. Protected cameras need an access token, as for any other data.</p></div>
      ${card('Camera', `<form id="cf" class="row"><select name="id" class="grow">${cams.map(c => `<option value="${esc(c.id)}">${esc(c.name.value)} (${esc(c.accessPolicyLabel?.value || '')})</option>`).join('')}</select><button class="btn" type="button" id="ctk">Get access token</button></form><p class="hint" id="cts">No token yet. Public cameras need none.</p>`, 'BIS-37')}
      <div class="grid2">${card('Live', `<div class="player"><img id="lv" alt="Live camera picture" width="640" height="360"><p class="hint" id="lvt">Stopped.</p></div><div class="row"><button class="btn primary" id="lplay">Play live</button><button class="btn" id="lpause">Pause</button><button class="btn danger" id="lstop">Stop</button></div>`, 'BIS-37')}
      ${card('Archive', `<div class="row"><label class="f">From<input type="datetime-local" id="af"></label><label class="f">To<input type="datetime-local" id="at"></label><button class="btn" id="aload">Load</button></div><div class="player"><img id="av" alt="Archived camera picture" width="640" height="360"><p class="hint" id="avt">Load a time range.</p></div><input type="range" id="aslide" min="0" max="0" value="0" class="grow"><div class="row"><button class="btn primary" id="aplay">Play</button><button class="btn" id="apause">Pause</button><button class="btn danger" id="astop">Stop</button><button class="btn" id="adl">Download this picture</button></div>`, 'BIS-37')}</div></div>`;
    let token = '', liveT = null, arcT = null, files = [];
    const camId = () => $('#cf').id.value;
    const hdr = () => (token ? { token } : {});
    const fetchPic = async (u) => { const r = await fetch(u, { headers: hdr(), credentials: 'same-origin' }); if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.status); } const b = await r.blob(); const url = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); return { url, ts: r.headers.get('x-media-time'), blob: b }; };
    const local = d => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    $('#af').value = local(new Date(Date.now() - 2 * 3600e3)); $('#at').value = local(new Date());
    $('#ctk').onclick = async () => { const r = await api('POST', '/auth/v1/token', { request: [{ id: camId() }], purpose: 'view camera' }); if (r.ok) { token = r.body.token; $('#cts').textContent = 'Token granted, expires ' + r.body.expiry + '.'; } else $('#cts').textContent = r.body.error; };
    $('#cf').id.onchange = () => { token = ''; $('#cts').textContent = 'No token yet. Public cameras need none.'; stopLive(); };
    const tick = async () => { try { const f = await fetchPic('/resource/v1/media/latest?id=' + encodeURIComponent(camId())); $('#lv').src = f.url; $('#lvt').textContent = 'Live · picture of ' + f.ts; } catch (e) { $('#lvt').textContent = String(e.message); stopLive(); } };
    const stopLive = () => { clearInterval(liveT); liveT = null; };
    $('#lplay').onclick = () => { stopLive(); tick(); liveT = setInterval(tick, 2000); };
    $('#lpause').onclick = () => { stopLive(); $('#lvt').textContent = 'Paused.'; };
    $('#lstop').onclick = () => { stopLive(); $('#lv').removeAttribute('src'); $('#lvt').textContent = 'Stopped.'; };
    const showFrame = async i => { const f = files[i]; if (!f) return; $('#aslide').value = i; try { const p = await fetchPic(`/resource/v1/media/file?id=${encodeURIComponent(camId())}&ts=${encodeURIComponent(f.ts)}`); $('#av').src = p.url; $('#avt').textContent = `${i + 1} of ${files.length} · ${f.ts}`; } catch (e) { $('#avt').textContent = String(e.message); } };
    const stopArc = () => { clearInterval(arcT); arcT = null; };
    $('#aload').onclick = async () => { stopArc(); const q = new URLSearchParams({ id: camId(), time: new Date($('#af').value).toISOString(), endtime: new Date($('#at').value).toISOString() }); const r = await api('GET', '/resource/v1/media/list?' + q, undefined, hdr()); if (!r.ok) { $('#avt').textContent = r.body.error; return; } files = r.body.files; $('#aslide').max = Math.max(0, files.length - 1); if (files.length) showFrame(0); else $('#avt').textContent = 'No pictures in that range.'; };
    $('#aslide').oninput = e => showFrame(Number(e.target.value));
    $('#aplay').onclick = () => { stopArc(); arcT = setInterval(() => { const i = Number($('#aslide').value) + 1; if (i >= files.length) return stopArc(); showFrame(i); }, 700); };
    $('#apause').onclick = () => { stopArc(); };
    $('#astop').onclick = () => { stopArc(); if (files.length) showFrame(0); };
    $('#adl').onclick = async () => { const f = files[Number($('#aslide').value)]; if (!f) return; const r = await fetch(`/resource/v1/media/file?id=${encodeURIComponent(camId())}&ts=${encodeURIComponent(f.ts)}`, { headers: hdr() }); const b = await r.blob(); const fr = new FileReader(); fr.onload = () => { const a = document.createElement('a'); a.href = fr.result; a.download = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'camera.svg'; a.click(); }; fr.readAsDataURL(b); };
    const obs = new MutationObserver(() => { if (!document.body.contains($('#lv'))) { stopLive(); stopArc(); obs.disconnect(); } }); obs.observe(m, { childList: true });
  },

  async trust(m) {
    const [csr, certs, crl, orgs, cas] = await Promise.all([api('GET', '/identity/v1/csr'), api('GET', '/identity/v1/certs'), api('GET', '/identity/v1/crl'), api('GET', '/identity/v1/orgs'), api('GET', '/identity/v1/trusted-cas')]);
    const admin = ME.role === 'admin';
    m.innerHTML = `<div class="view"><div class="view-head"><h2>Certificates and trust</h2><p>The DX Certificate Authority, certificate requests, revocation and organisations (BIS 5.3, 5.4.2, 7.1).</p></div>
      ${card('Certificate requests', table(csr.body.map(r => ({ id: r.id, email: r.email, class: r.cls, kind: r.kind, status: r.status, serial: r.cert_serial || '' }))) + (admin ? `<form id="df" class="row"><input name="id" placeholder="request id" required><button class="btn primary" name="a" value="1">Approve and issue</button><button class="btn danger" name="a" value="0">Reject</button></form><div id="do"></div>` : ''), 'BIS-75 BIS-96')}
      ${card('Issued certificates', table(certs.body.map(c => ({ serial: c.serial, holder: c.email, cn: c.cn, class: c.cls, kind: c.kind, status: c.status, expires: c.not_after }))) + (admin ? `<form id="vf" class="row"><input name="serial" placeholder="serial" required><select name="reason"><option>keyCompromise</option><option>affiliationChanged</option><option>superseded</option><option>cessationOfOperation</option></select><button class="btn danger">Revoke</button></form><div id="vo"></div>` : ''), 'BIS-76 BIS-65')}
      <div class="grid2">${card('Revocation list', `<p class="small">Last update ${esc(crl.body.lastUpdate)}, next ${esc(crl.body.nextUpdate)}</p>${table(crl.body.revokedSerials.map(s => ({ serial: s })))}<p><a href="/identity/v1/crl.pem">Download CRL (PEM)</a></p>`, 'BIS-65')}
      ${card('Trusted certificate authorities', table(cas.body.cas.map(c => ({ subject: c.subject, expires: c.notAfter }))), 'BIS-59')}</div>
      ${card('Organisations and white-list', table(orgs.body.map(o => ({ id: o.id, name: o.name, domain: o.domain, whitelisted: o.whitelisted ? 'yes' : 'no' }))), 'BIS-75')}
      ${admin ? `<div class="grid2">${card('Add a department', `<form id="adf" class="col"><p class="hint">Registers and white-lists the department and gives it an organisation certificate, so its staff can have certificates (BIS 5.4.2).</p><input name="id" placeholder="short id, e.g. kjs" required><input name="name" placeholder="name, e.g. Kanpur Jal Sansthan" required><input name="domain" placeholder="e-mail domain, e.g. kjs.kanpur-demo.example" required><button class="btn primary">Add department</button></form><div id="ado"></div>`)}
      ${card('Add a person', `<form id="apf" class="col"><p class="hint">Issues a certificate and a login. The e-mail domain decides the department. The person must change the password at first login.</p><input name="name" placeholder="full name" required><input name="email" placeholder="e-mail, e.g. ee@kjs.kanpur-demo.example" required><div class="row"><label class="f">Kind<select name="kind"><option value="officer">Data officer (class 3)</option><option value="emp">Employee</option><option value="ind">Individual (class 2)</option></select></label><label class="f">Class<select name="cls"><option>3</option><option>2</option><option>4</option><option>5</option></select></label><label class="f">Role<select name="role">${['provider', 'consumer', 'operator', 'analytics_provider', 'auditor'].map(r => `<option>${r}</option>`).join('')}</select></label></div><div class="row"><input name="username" placeholder="username" required><input name="password" placeholder="temporary password (12+ letters and digits)" required></div><button class="btn primary">Add person</button></form><div id="apo"></div>`)}</div>
      ${card('Logins', '<div id="acc"></div>')}` : ''}</div>`;
    if (admin) {
      const accts = async () => { const a = await api('GET', '/identity/v1/accounts'); $('#acc').innerHTML = table(a.body.map(x => ({ username: x.username, name: x.display_name, role: x.role, certificate: x.cert_serial || '', locked: x.locked_until && new Date(x.locked_until) > new Date() ? 'yes' : '' }))) + `<form id="uf" class="row"><input name="username" placeholder="username" required><button class="btn">Unlock</button></form>`; $('#uf').onsubmit = async e => { e.preventDefault(); const r = await api('POST', '/identity/v1/accounts/unlock', Object.fromEntries(new FormData(e.target))); toast(r.ok ? 'Unlocked' : r.body.error); }; };
      $('#adf').onsubmit = async e => { e.preventDefault(); const r = await api('POST', '/identity/v1/departments', Object.fromEntries(new FormData(e.target))); out($('#ado'), r); if (r.ok) toast('Department added. Reopen this screen to see it in the lists.'); };
      $('#apf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.cls = Number(f.cls); const r = await api('POST', '/identity/v1/people', f); out($('#apo'), r); if (r.ok) accts(); };
      accts();
      $('#df').onsubmit = async e => { e.preventDefault(); const id = new FormData(e.target).get('id'); const r = await api('POST', '/identity/v1/csr/decide', { id, approve: e.submitter.value === '1' }); out($('#do'), r); };
      $('#vf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!confirm('Revoke certificate ' + f.serial + '? This cannot be undone.')) return; out($('#vo'), await api('POST', '/identity/v1/certs/revoke', f)); };
    }
  },

  async ops(m) {
    const [au, ver, st, bk] = await Promise.all([api('GET', '/ops/v1/audit?limit=100'), api('GET', '/ops/v1/audit/verify'), api('GET', '/ops/v1/stats'), api('GET', '/ops/v1/backups')]);
    const admin = ME.role === 'admin';
    m.innerHTML = `<div class="view"><div class="view-head"><h2>Operations and audit</h2><p>Signed audit log, statistics, backups and service drills (BIS 5.5, 5.6).</p></div>
      ${card('Audit log', `<p>${ver.body.ok ? pill('chain verified', 'ok') + ` ${ver.body.checked} entries, hash chain and Ed25519 signatures intact` : pill('broken', 'bad') + ' at entry ' + esc(ver.body.brokenAt) + ': ' + esc(ver.body.reason)}</p>${table(au.body.map(a => ({ seq: a.seq, time: a.ts, interface: a.iface, actor: a.actor, action: a.action, detail: a.detail, ok: a.ok ? 'yes' : 'refused' })))}`, 'BIS-11 BIS-77')}
      ${card('Statistics by interface', table(st.body.audit), 'BIS-77')}
      ${admin ? card('Backups', `<button class="btn primary" id="bb">Take backup now</button><div id="bo"></div>${table(bk.body)}`, 'BIS-78') : ''}
      ${admin ? card('Service drills', `<p class="hint">Pause a service to test the failure handling in BIS 5.6. Remember to resume it.</p><div class="row">${['authorization', 'notification', 'cil', 'urn:demo-cat:rs/rs1', 'urn:demo-cat:rs/rs2'].map(s => `<button class="btn sm" data-s="${s}" data-u="0">Pause ${s}</button><button class="btn sm" data-s="${s}" data-u="1">Resume</button>`).join('')}</div><div id="so"></div>`, 'BIS-80 BIS-83') : ''}</div>`;
    if (admin) {
      $('#bb').onclick = async () => { out($('#bo'), await api('POST', '/ops/v1/backup', { label: 'console' })); };
      m.querySelector('[data-s]').parentElement.onclick = async e => { const b = e.target.closest('[data-s]'); if (!b) return; out($('#so'), await api('POST', '/ops/v1/service', { service: b.dataset.s, up: b.dataset.u === '1' })); };
    }
  },

  async status(m) {
    const s = await api('GET', '/status/v1');
    m.innerHTML = `<div class="view"><div class="view-head"><h2>Status page</h2><p>${esc(s.body.note)} Window: last ${s.body.windowHours} hours.</p></div>${card('Services', table(s.body.services.map(x => ({ service: x.name, status: x.status, 'uptime %': x.uptimePercent, requests: x.requests, 'avg ms': x.avgResponseMs, 'p95 ms': x.p95LatencyMs, '5xx': x.serverErrors }))), 'BIS-79')}</div>`;
  },
};

boot();
