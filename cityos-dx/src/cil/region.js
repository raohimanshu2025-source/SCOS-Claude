// State-level and sector-wise performance reports (City OS Section 1, Figure 2, and Section 4).
// Each city's City Intelligence Layer computes a few sector figures from its own data exchange data and publishes
// them as a public resource item ("city performance figures", aggregates only, no personal data).
// A state node (DX_TIER=state) lists its cities in DX_FEDERATION_PEERS and reads each city's figures through that
// city's data exchange (catalogue search, then resource API), so the data exchange is the backplane between COSs.
// A national node (DX_TIER=national) lists state nodes and reads their state reports in turn.
// Every report has the same output shape at every level, so the output APIs are common.
import https from 'node:https';
import fs from 'node:fs';
import { q } from '../db.js';
import { iso, round } from '../util.js';
import { actorOf } from '../identity/identity.js';

// sector, figure, unit, which way is better, how a state or nation combines it, and how a city computes it
const KPIS = [
  ['Transport', 'Buses on time', 'percent', 'higher', 'mean', '/publictransit/fleetPerformance', o => o.fleetOnTimePercent],
  ['Transport', 'Bus farebox ratio', 'ratio', 'higher', 'mean', '/publictransit/financialPerformance', o => o.rows.find(r => r.mode === 'bus')?.fareboxRatio],
  ['Transport', 'Metro farebox ratio', 'ratio', 'higher', 'mean', '/publictransit/financialPerformance', o => o.rows.find(r => r.mode === 'metro')?.fareboxRatio],
  ['Solid waste', 'Waste expected tomorrow', 'tonnes', 'lower', 'sum', '/swm/dailyEstimate', o => round(o.rows.reduce((a, r) => a + r.estimateTonnes, 0))],
  ['Solid waste', 'Wards with unusual waste today', 'wards', 'lower', 'sum', '/swm/anomalies', o => o.rows.length],
  ['Flood and drainage', 'Drains on flood alert', 'drains', 'lower', 'sum', '/flood/alerts', o => o.rows.length],
  ['Flood and drainage', 'Average drain use', 'percent of capacity', 'lower', 'mean', '/flood/drainStatus', o => (o.rows.length ? round(o.rows.reduce((a, r) => a + r.percentOfCapacity, 0) / o.rows.length) : null)],
  ['Environment', 'Highest PM2.5 (observed and forecast)', 'ug/m3', 'lower', 'mean', '/environment/spatialForecast', o => o.max],
  ['Environment', 'Hottest spot above city mean', 'degree Celsius', 'lower', 'mean', '/weather/heatIsland', o => o.max],
  ['Citizen services', 'Complaints in the top categories', 'complaints', 'lower', 'sum', '/grievance/top', o => o.rows.reduce((a, r) => a + r.count, 0)],
];
export const TIERS = ['city', 'state', 'national'];
const PERF_TAG = 'city-performance';

export function makeRegion({ db, cfg, audit, catalogue, cil }) {
  const perfItem = () => catalogue.all('resourceItem').find(i => (i.doc.tags?.value || []).includes(PERF_TAG));

  // This city's figures, computed by the CIL service identity and stored in the public item.
  function computeCity(by = 'CIL scheduler') {
    const svc = cil.serviceSelf();
    const kpis = [];
    const outs = {};
    for (const [sector, kpi, unit, better, combine, path, pick] of KPIS) {
      let value = null;
      try { outs[path] ??= cil.call(svc, path, {}).output; value = pick(outs[path]) ?? null; } catch { value = null; }
      kpis.push({ sector, kpi, unit, better, combine, source: path, value: Number.isFinite(value) ? value : null });
    }
    const packet = { city: cfg.cityName, tier: 'city', kpis, observationDateTime: iso(Date.now()) };
    const it = perfItem();
    if (it) q.run(db, 'INSERT OR REPLACE INTO readings (item_id, ts, data) VALUES (?,?,?)', it.id, packet.observationDateTime, JSON.stringify(packet));
    audit.log('CIL', by, 'City performance figures computed', `${kpis.filter(k => k.value !== null).length} of ${kpis.length} figures${it ? ' published to ' + it.id : ''}`);
    return packet;
  }
  function latestCity() {
    const it = perfItem();
    const r = it && q.get(db, 'SELECT data FROM readings WHERE item_id=? ORDER BY ts DESC LIMIT 1', it.id);
    const d = r && JSON.parse(r.data);
    return d && Date.now() - Date.parse(d.observationDateTime) < 3600e3 ? d : computeCity();
  }

  const ca = () => (cfg.federationCaFile && fs.existsSync(cfg.federationCaFile) ? fs.readFileSync(cfg.federationCaFile) : undefined);
  function get(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { ca: ca(), timeout: 8000 }, res => {
        let d = ''; res.on('data', c => (d += c));
        res.on('end', () => { try { const j = JSON.parse(d); res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || 'HTTP ' + res.statusCode)); } catch { reject(new Error('not JSON from ' + url)); } });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
  }
  // One member: on a state node, a city read through its data exchange; on a national node, a state node's report.
  async function member(peer) {
    const [name, url] = peer.includes('=') ? peer.split('=') : [peer, peer];
    try {
      if (cfg.tier === 'state') {
        const found = await get(new URL(`/catalogue/v1/search?q=${PERF_TAG}&type=resourceItem`, url));
        const id = found.results?.[0]?.id;
        if (!id) throw new Error('no city performance item in its catalogue');
        const d = await get(new URL(`/resource/v1/latest?id=${encodeURIComponent(id)}`, url));
        const pk = Array.isArray(d.results) ? d.results[0] : d;
        if (!pk?.kpis) throw new Error('the city has not published its figures yet');
        return { name: pk.city || name, level: 'city', ok: true, via: `data exchange of ${name}: ${id}`, observed: pk.observationDateTime, kpis: pk.kpis };
      }
      const r = await get(new URL('/cil/v1/reports/region', url));
      return { name: r.name || name, level: r.level, ok: true, via: `report API of ${name}`, observed: r.generatedAt, kpis: r.kpis, members: r.members.map(m => ({ name: m.name, level: m.level, ok: m.ok })) };
    } catch (e) { return { name, level: null, ok: false, error: e.message }; }
  }

  function combine(members) {
    return KPIS.map(([sector, kpi, unit, better, how]) => {
      const per = members.filter(m => m.ok).map(m => ({ name: m.name, value: m.kpis?.find(k => k.sector === sector && k.kpi === kpi)?.value ?? null }));
      const vals = per.map(x => x.value).filter(Number.isFinite);
      const value = !vals.length ? null : how === 'sum' ? round(vals.reduce((a, b) => a + b, 0)) : round(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
      const sorted = per.filter(x => Number.isFinite(x.value)).sort((a, b) => (better === 'higher' ? b.value - a.value : a.value - b.value));
      return { sector, kpi, unit, better, combine: how, value, perMember: per, best: sorted.length > 1 ? sorted[0].name : null, worst: sorted.length > 1 ? sorted.at(-1).name : null };
    });
  }

  let timer = null;
  const safeCompute = () => { try { if (perfItem() && cil.serviceSelf()) computeCity(); } catch (e) { console.error('city figures', e.message); } };
  return {
    computeCity,
    // every hour with the scheduler, so state nodes always find fresh figures in this city's data exchange
    start() { if (cfg.schedulerEnabled && !timer) { setImmediate(safeCompute); timer = setInterval(safeCompute, 3600e3); timer.unref(); } },
    stop() { clearInterval(timer); timer = null; },
    // GET /cil/v1/reports/region: the sector-wise report of this city, state or nation.
    async report(p) {
      const tier = TIERS.includes(cfg.tier) ? cfg.tier : 'city';
      let members;
      if (tier === 'city') { const d = latestCity(); members = [{ name: cfg.cityName, level: 'city', ok: true, via: 'this data exchange', observed: d.observationDateTime, kpis: d.kpis }]; }
      else members = await Promise.all(cfg.federationPeers.map(member));
      const kpis = combine(members);
      const sectors = [...new Set(KPIS.map(k => k[0]))].map(s => ({ sector: s, kpis: kpis.filter(k => k.sector === s) }));
      audit.log('CIL', p ? actorOf(p) : 'anonymous', `${tier[0].toUpperCase() + tier.slice(1)} report generated`, `${cfg.regionName || cfg.cityName}: ${members.filter(m => m.ok).length} of ${members.length} member(s) answered`);
      return { level: tier, name: tier === 'city' ? cfg.cityName : cfg.regionName, generatedAt: iso(Date.now()), note: 'Aggregated figures only; demo data unless the cities feed real data.', members, kpis, sectors };
    },
  };
}
