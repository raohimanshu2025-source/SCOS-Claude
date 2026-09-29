// Built-in City Intelligence Layer analytics (City OS Section 3, six target domains; Figures 9 and 10).
// Every analytic reads its inputs only through the data exchange (catalogue groups + resource rows),
// described with the Figure 12 ontology. Methods are simple, documented formulas, not trained models.
import { round, mean, iso } from '../util.js';
import { distKm } from '../dx/catalogue.js';

const inp = (group, type, role, attr) => ({ group, type, role, attr });
const clean = a => a.filter(v => typeof v === 'number' && Number.isFinite(v) && v > -100);
const hhmm = t => new Date(t).toISOString().slice(11, 16);

// Snapshot of the inputs, built from the data exchange by cil.js
export function wardOf(snap, [x, y]) {
  for (const w of snap.wards) { const b = w.bbox; if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return w.id; }
  return 'outside wards';
}
function idwGrid(pts, n, bbox) {
  const [w, s, e, nn] = bbox; const cells = []; let min = Infinity, max = -Infinity;
  for (let j = 0; j < n; j++) {
    const row = [];
    for (let i = 0; i < n; i++) {
      const x = w + (i + 0.5) * (e - w) / n, y = s + (j + 0.5) * (nn - s) / n; let a = 0, b = 0;
      for (const p of pts) { const d = Math.max(0.05, distKm([x, y], p.loc)); const wt = 1 / (d * d); a += wt * p.v; b += wt; }
      const v = round(a / b, 1); row.push(v); min = Math.min(min, v); max = Math.max(max, v);
    }
    cells.push(row);
  }
  return { cells, n, min, max, bbox };
}
const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
function distToRoute(p, stops) { let best = Infinity; for (let k = 0; k < stops.length - 1; k++) for (let f = 0; f <= 1.0001; f += 0.05) best = Math.min(best, distKm(p, lerp(stops[k].loc, stops[k + 1].loc, f))); return best; }
function nearestStopIdx(stops, loc) { let si = 0, bd = Infinity; stops.forEach((s, k) => { const d = distKm(s.loc, loc); if (d < bd) { bd = d; si = k; } }); return { si, d: bd }; }
function segOf(stops, loc) { let best = 0, bd = Infinity; for (let k = 0; k < stops.length - 1; k++) for (let f = 0; f <= 1.0001; f += 0.05) { const d = distKm(loc, lerp(stops[k].loc, stops[k + 1].loc, f)); if (d < bd) { bd = d; best = k; } } return best; }
const windowRows = (rows, tf, a, b) => rows.filter(r => { const t = Date.parse(r[tf]); return t >= a && t <= b; });
const wasteByWard = snap => { const m = {}; for (const r of snap.waste) (m[r.ward] ||= []).push(r); for (const k in m) m[k].sort((a, b) => a.date.localeCompare(b.date)); return m; };

export const BUILTINS = [
  { id: 'aq-forecast', domain: 'Air Quality', name: 'Air quality spatio-temporal interpolation', path: '/environment/spatialForecast', provider: 'Pollution Control Cell (demo)',
    inputs: [inp('aqm', 'Time Series', 'RequiresDataSource', 'PM2_5'), inp('aqm', 'Hash Map', 'RequiresAdditionalDataSource', 'location')],
    out: 'MeshGrid', viz: 'Map Raster', period: 15, dataPeriodicity: '15 min', provenance: 'City OS paper Figure 9',
    procedure: 'Inverse distance weighting of mean PM2.5 per sensor over the requested window onto a 20 x 20 grid; sensors above 90 ug/m3 raise an alert (demo threshold)',
    params: { spatialRange: 'array [west,south,east,north]', forecastStart: 'date-time', forecastEnd: 'date-time' },
    defaults: s => ({ spatialRange: s.bbox, forecastStart: iso(s.now - 2 * 3600e3), forecastEnd: iso(s.now) }),
    run(s, b) {
      const a = Date.parse(b.forecastStart), e = Date.parse(b.forecastEnd);
      if (isNaN(a) || isNaN(e) || e < a) throw new Error('forecastStart and forecastEnd must be date-times, start before end');
      if (!Array.isArray(b.spatialRange) || b.spatialRange.length !== 4 || !b.spatialRange.every(Number.isFinite)) throw new Error('spatialRange must be [west,south,east,north]');
      const pts = s.aq.map(x => ({ id: x.id, loc: x.loc, v: mean(clean(windowRows(x.rows, 'LASTUPDATEDATETIME', a, e).map(r => r.PM2_5))) })).filter(p => Number.isFinite(p.v) && p.v > 0);
      if (!pts.length) throw new Error('no readings between forecastStart and forecastEnd');
      const g = idwGrid(pts, 20, b.spatialRange);
      const alerts = pts.filter(p => p.v > 90).map(p => ({ sensor: p.id, ward: wardOf(s, p.loc), meanPM2_5: round(p.v) }));
      return { output: { type: 'MeshGrid', unit: 'ug/m3', gridRows: 20, gridCols: 20, min: g.min, max: g.max, cells: g.cells, bbox: g.bbox, sensors: pts.map(p => ({ id: p.id, loc: p.loc, meanPM2_5: round(p.v) })), alerts },
        alerts: alerts.map(x => ({ ward: x.ward, msg: `PM2.5 ${x.meanPM2_5} ug/m3 at ${x.sensor}` })) };
    } },
  { id: 'eta', domain: 'Intelligent Transit', name: 'Estimated time of arrival', path: '/publictransit/eta', provider: 'City Transport Undertaking (demo)',
    inputs: [inp('itms', 'Time Series', 'RequiresDataSource', 'location'), inp('stops', 'Hash Map', 'RequiresAdditionalDataSource', 'location')],
    out: 'Single Stat', viz: 'Table', period: 1, dataPeriodicity: '30 s', provenance: 'City OS paper Figure 10',
    procedure: 'Distance along the route from the nearest earlier bus to the stop nearest the given location, divided by that bus speed, plus 30 s dwell per stop',
    params: { routeid: 'string', currentlocation: 'array [lon,lat]' },
    defaults: s => { const r = Object.keys(s.routes)[0]; return { routeid: r, currentlocation: s.routes[r]?.stops.at(-2)?.loc }; },
    run(s, b) {
      const r = s.routes[b.routeid]; if (!r) throw new Error('unknown routeid; use one of ' + Object.keys(s.routes).join(', '));
      if (!Array.isArray(b.currentlocation) || b.currentlocation.length !== 2) throw new Error('currentlocation must be [lon,lat]');
      const { si } = nearestStopIdx(r.stops, b.currentlocation); let best = null;
      for (const bus of s.buses.filter(x => x.routeId === b.routeid)) {
        if (distToRoute(bus.loc, r.stops) > 0.3) continue; // off route: not counted
        const seg = segOf(r.stops, bus.loc); if (seg >= si) continue;
        let d = distKm(bus.loc, r.stops[seg + 1].loc); for (let k = seg + 1; k < si; k++) d += distKm(r.stops[k].loc, r.stops[k + 1].loc);
        const m = d / Math.max(bus.speed, 5) * 60 + (si - seg - 1) * 0.5; if (!best || m < best.m) best = { m, bus: bus.busId };
      }
      return { output: { type: 'SingleStat', stop: r.stops[si].stopId, value: best ? round(best.m, 0) : null, unit: 'minutes', bus: best?.bus ?? 'none approaching' } };
    } },
  { id: 'traffic', domain: 'Intelligent Transit', name: 'Traffic hotspots', path: '/publictransit/trafficHotspots', provider: 'City Transport Undertaking (demo)',
    inputs: [inp('itms', 'Time Series', 'RequiresDataSource', 'speed')], out: 'Table', viz: 'Map Vectors', period: 5, dataPeriodicity: '30 s', provenance: 'City OS paper Section 3 (2)',
    procedure: 'Places where the latest bus speed is under 10 km/h', params: { maxSpeedKmh: 'number' }, defaults: () => ({ maxSpeedKmh: 10 }),
    run(s, b) { const lim = Number(b.maxSpeedKmh ?? 10); return { output: { type: 'Table', rows: s.buses.filter(x => x.speed < lim).map(x => ({ bus: x.busId, route: x.routeId, ward: wardOf(s, x.loc), speedKmh: x.speed, loc: x.loc })) } }; } },
  { id: 'fleet', domain: 'Intelligent Transit', name: 'Fleet performance and status', path: '/publictransit/fleetPerformance', provider: 'City Transport Undertaking (demo)',
    inputs: [inp('itms', 'Time Series', 'RequiresDataSource', 'delayMinutes')], out: 'Table', viz: 'Bar', period: 60, dataPeriodicity: '30 s', provenance: 'City OS paper Section 3 (2) and Figure 8',
    procedure: 'Share of the last 24 h packets per bus with delay of 5 minutes or less; status from the latest packet', params: {}, defaults: () => ({}),
    run(s) {
      const rows = s.buses.map(x => { const d = x.history.map(h => h.delayMinutes); return { bus: x.busId, route: x.routeId, onTimePercent: round(100 * d.filter(v => v <= 5).length / (d.length || 1), 0), status: x.delay > 5 ? 'late' : 'on time' }; });
      return { output: { type: 'Table', city: s.city, fleetOnTimePercent: round(mean(rows.map(r => r.onTimePercent)), 0), rows } };
    } },
  { id: 'deviation', domain: 'Intelligent Transit', name: 'Deviation from scheduled route', path: '/publictransit/routeDeviation', provider: 'City Transport Undertaking (demo)',
    inputs: [inp('itms', 'Time Series', 'RequiresDataSource', 'location'), inp('stops', 'Hash Map', 'RequiresAdditionalDataSource', 'location')],
    out: 'Table', viz: 'Map Vectors', period: 2, dataPeriodicity: '30 s', provenance: 'City OS paper Section 3 (2)',
    procedure: 'Buses more than thresholdMetres from their route line; each raises an alert', params: { thresholdMetres: 'number' }, defaults: () => ({ thresholdMetres: 300 }),
    run(s, b) {
      const th = Number(b.thresholdMetres ?? 300);
      const rows = s.buses.filter(x => s.routes[x.routeId]).map(x => ({ bus: x.busId, route: x.routeId, ward: wardOf(s, x.loc), metresFromRoute: Math.round(distToRoute(x.loc, s.routes[x.routeId].stops) * 1000) })).filter(r => r.metresFromRoute > th);
      return { output: { type: 'Table', rows }, alerts: rows.map(r => ({ ward: r.ward, msg: `${r.bus} is ${r.metresFromRoute} m off ${r.route}` })) };
    } },
  { id: 'swm-est', domain: 'Solid Waste', name: 'Daily dumping estimation', path: '/swm/dailyEstimate', provider: 'Municipal Corporation (demo)',
    inputs: [inp('swm', 'Time Series', 'RequiresDataSource', 'tonnes')], out: 'Series Forecast', viz: 'Bar', period: 1440, dataPeriodicity: 'daily', provenance: 'City OS paper Section 3 (3)',
    procedure: "Tomorrow's tonnes per ward = mean of last 7 days plus one day of the 7-day trend", params: {}, defaults: () => ({}),
    run(s) { const w = wasteByWard(s); return { output: { type: 'SeriesForecast', date: 'next day', rows: Object.entries(w).map(([ward, r]) => { const t = r.map(x => x.tonnes), l7 = t.slice(-7), p7 = t.slice(-14, -7); return { ward, estimateTonnes: round(mean(l7) + (p7.length ? (mean(l7) - mean(p7)) / 7 : 0)) }; }) } }; } },
  { id: 'swm-zones', domain: 'Solid Waste', name: 'Dumping zone identification', path: '/swm/dumpingZones', provider: 'Municipal Corporation (demo)',
    inputs: [inp('swm', 'Time Series', 'RequiresDataSource', 'tonnes'), inp('gis', 'Hash Map', 'RequiresAdditionalDataSource', 'boundary')], out: 'Table', viz: 'Map Raster', period: 1440, dataPeriodicity: 'daily', provenance: 'City OS paper Section 3 (3)',
    procedure: 'Wards ranked by total tonnage in the data; the top three are the main dumping zones', params: { top: 'number' }, defaults: () => ({ top: 3 }),
    run(s, b) { const w = wasteByWard(s); const rows = Object.entries(w).map(([ward, r]) => [ward, round(r.reduce((a, x) => a + x.tonnes, 0))]).sort((a, c) => c[1] - a[1]).slice(0, Number(b.top) || 3).map(([ward, t], i) => ({ rank: i + 1, ward, tonnes: t })); return { output: { type: 'Table', rows } }; } },
  { id: 'swm-anom', domain: 'Solid Waste', name: 'Dumping trend anomalies and surge handling', path: '/swm/anomalies', provider: 'Municipal Corporation (demo)',
    inputs: [inp('swm', 'Time Series', 'RequiresDataSource', 'tonnes')], out: 'Table', viz: 'Table', period: 60, dataPeriodicity: 'daily', provenance: 'City OS paper Section 3 (3)',
    procedure: 'Z-score of the latest day against the earlier days; above zThreshold is a surge and raises an alert', params: { zThreshold: 'number' }, defaults: () => ({ zThreshold: 2 }),
    run(s, b) {
      const rows = Object.entries(wasteByWard(s)).map(([ward, r]) => { const t = r.map(x => x.tonnes), h = t.slice(0, -1), m = mean(h), sd = Math.sqrt(mean(h.map(x => (x - m) ** 2))) || 1; return { ward, today: t.at(-1), mean: round(m), z: round((t.at(-1) - m) / sd, 2) }; }).filter(r => r.z > Number(b.zThreshold ?? 2));
      return { output: { type: 'Table', rows, action: rows.length ? 'send an extra vehicle; see /swm/redistribution' : 'none' }, alerts: rows.map(r => ({ ward: r.ward, msg: `Waste surge in ${r.ward}: ${r.today} t (z ${r.z})` })) };
    } },
  { id: 'swm-route', domain: 'Solid Waste', name: 'Daily routes and schedules', path: '/swm/routePlan', provider: 'Municipal Corporation (demo)',
    inputs: [inp('swm', 'Time Series', 'RequiresDataSource', 'tonnes'), inp('gis', 'Hash Map', 'RequiresAdditionalDataSource', 'boundary')], out: 'Table', viz: 'Map Vectors', period: 1440, dataPeriodicity: 'daily', provenance: 'City OS paper Section 3 (3)',
    procedure: 'Nearest-neighbour order of ward centres from the depot at 20 km/h, 20 minutes per 10 t collected', params: { depot: 'array [lon,lat]', start: 'HH:MM' },
    defaults: s => ({ depot: [s.bbox[0] + 0.002, s.bbox[1] + 0.002], start: '06:00' }),
    run(s, b) {
      const w = wasteByWard(s); let cur = b.depot; const [hh, mm] = String(b.start || '06:00').split(':').map(Number); let t = hh * 60 + mm; const left = s.wards.filter(x => w[x.id]); const rows = [];
      while (left.length) { left.sort((x, y) => distKm(cur, x.c) - distKm(cur, y.c)); const x = left.shift(); t += Math.round(distKm(cur, x.c) / 20 * 60); const tn = w[x.id].at(-1).tonnes; rows.push({ stop: rows.length + 1, ward: x.id, arrive: `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, expectedTonnes: tn }); t += Math.round(tn / 10 * 20); cur = x.c; }
      return { output: { type: 'Table', rows } };
    } },
  { id: 'swm-redis', domain: 'Solid Waste', name: 'Dumping redistribution recommendations', path: '/swm/redistribution', provider: 'Municipal Corporation (demo)',
    inputs: [inp('swm', 'Time Series', 'RequiresDataSource', 'tonnes')], out: 'Table', viz: 'Table', period: 1440, dataPeriodicity: 'daily', provenance: 'City OS paper Section 3 (3)',
    procedure: 'Move tonnes above a ward capacity to the nearest ward with spare capacity (capacity is an input)', params: { wardCapacityTonnes: 'number' }, defaults: () => ({ wardCapacityTonnes: 60 }),
    run(s, b) {
      const cap = Number(b.wardCapacityTonnes) || 60; const w = wasteByWard(s); const c = id => s.wards.find(x => x.id === id).c;
      const load = Object.entries(w).map(([ward, r]) => ({ ward, t: r.at(-1).tonnes })); const rows = [];
      for (const l of load.filter(x => x.t > cap)) { const to = load.filter(x => x.t < cap).sort((a, d) => distKm(c(l.ward), c(a.ward)) - distKm(c(l.ward), c(d.ward)))[0]; if (to) { const mv = round(Math.min(l.t - cap, cap - to.t)); rows.push({ from: l.ward, to: to.ward, moveTonnes: mv }); to.t += mv; } }
      return { output: { type: 'Table', rows } };
    } },
  { id: 'drain', domain: 'Flood', name: 'Storm water drain flow and level status', path: '/flood/drainStatus', provider: 'Water and Drainage Department (demo)',
    inputs: [inp('drains', 'Time Series', 'RequiresDataSource', 'level'), inp('drains', 'Time Series', 'RequiresAdditionalDataSource', 'flow')], out: 'Table', viz: 'Bar', period: 5, dataPeriodicity: '15 min', provenance: 'City OS paper Section 3 (4)',
    procedure: 'Latest level, flow and percent of capacity per drain', params: {}, defaults: () => ({}),
    run(s) { return { output: { type: 'Table', rows: s.drains.map(d => { const l = d.rows.at(-1) || {}; return { drain: d.id, ward: wardOf(s, d.loc), levelM: l.level, flowM3s: l.flow, percentOfCapacity: Math.round(100 * l.level / l.capacity), observed: l.observationDateTime }; }) } }; } },
  { id: 'flood-alert', domain: 'Flood', name: 'Flood alerts', path: '/flood/alerts', provider: 'Water and Drainage Department (demo)',
    inputs: [inp('drains', 'Time Series', 'RequiresDataSource', 'level'), inp('drains', 'Hash Map', 'RequiresAdditionalDataSource', 'capacity')], out: 'Table', viz: 'Map Vectors', period: 5, dataPeriodicity: '15 min', provenance: 'City OS paper Section 3 (4)',
    procedure: 'Amber at amberPercent of capacity, Red at redPercent', params: { amberPercent: 'number', redPercent: 'number' }, defaults: () => ({ amberPercent: 75, redPercent: 90 }),
    run(s, b) {
      const am = Number(b.amberPercent ?? 75) / 100, rd = Number(b.redPercent ?? 90) / 100;
      const rows = s.drains.map(d => ({ d, l: d.rows.at(-1) })).filter(x => x.l && x.l.level / x.l.capacity >= am).map(({ d, l }) => ({ drain: d.id, ward: wardOf(s, d.loc), severity: l.level / l.capacity >= rd ? 'Red' : 'Amber', percentOfCapacity: Math.round(100 * l.level / l.capacity), observed: l.observationDateTime }));
      return { output: { type: 'Table', rows }, alerts: rows.map(r => ({ ward: r.ward, msg: `${r.severity}: ${r.drain} at ${r.percentOfCapacity}% of capacity` })) };
    } },
  { id: 'flood-vuln', domain: 'Flood', name: 'Flood vulnerability analysis', path: '/flood/vulnerability', provider: 'Water and Drainage Department (demo)',
    inputs: [inp('drains', 'Time Series', 'RequiresDataSource', 'level'), inp('weather', 'Time Series', 'RequiresAdditionalDataSource', 'rainfall'), inp('grievview', 'Categorical', 'RequiresAdditionalDataSource', 'count')],
    out: 'Table', viz: 'Map Raster', period: 60, dataPeriodicity: 'hourly', provenance: 'City OS paper Section 3 (4)',
    procedure: 'Score per ward = 50 x highest drain use + 2 x water-logging complaints + rain in last 4 h (mm) / 4. Weights are demo values set by the analytics provider', params: {}, defaults: () => ({}),
    run(s) {
      const rows = s.wards.map(w => {
        const dr = s.drains.filter(d => wardOf(s, d.loc) === w.id).map(d => d.rows.at(-1)).filter(Boolean);
        const use = dr.length ? Math.max(...dr.map(l => l.level / l.capacity)) : 0.3;
        const comp = s.grievCounts.filter(g => g.ward === w.id && g.category === 'Water logging').reduce((a, g) => a + g.count, 0);
        const st = s.wx.slice().sort((a, b) => distKm(a.loc, w.c) - distKm(b.loc, w.c))[0];
        const rain = st ? st.rows.filter(r => Date.parse(r.observationDateTime) > s.now - 4 * 3600e3).reduce((a, r) => a + r.rainfall, 0) : 0;
        return { ward: w.id, score: round(50 * use + 2 * comp + rain / 4), drainUse: round(use, 2), waterLoggingComplaints: comp, rain4hMm: round(rain) };
      }).sort((a, b) => b.score - a.score);
      return { output: { type: 'Table', rows } };
    } },
  { id: 'wx-interp', domain: 'Weather', name: 'Temperature interpolation', path: '/weather/interpolation', provider: 'Municipal Corporation (demo)',
    inputs: [inp('weather', 'Time Series', 'RequiresDataSource', 'airTemperature'), inp('weather', 'Hash Map', 'RequiresAdditionalDataSource', 'location')], out: 'MeshGrid', viz: 'Map Raster', period: 15, dataPeriodicity: '15 min', provenance: 'City OS paper Section 3 (5)',
    procedure: 'Inverse distance weighting of the latest air temperature onto a 20 x 20 grid', params: { spatialRange: 'array [west,south,east,north]' }, defaults: s => ({ spatialRange: s.bbox }),
    run(s, b) { const pts = s.wx.map(x => ({ loc: x.loc, v: x.rows.at(-1)?.airTemperature })).filter(p => Number.isFinite(p.v)); const g = idwGrid(pts, 20, b.spatialRange || s.bbox); return { output: { type: 'MeshGrid', unit: 'degree Celsius', min: g.min, max: g.max, cells: g.cells, bbox: g.bbox } }; } },
  { id: 'wx-forecast', domain: 'Weather', name: 'Weather forecast (simple trend)', path: '/weather/forecast', provider: 'Municipal Corporation (demo)',
    inputs: [inp('weather', 'Time Series', 'RequiresDataSource', 'airTemperature')], out: 'Series Forecast', viz: 'Line', period: 60, dataPeriodicity: '15 min', provenance: 'City OS paper Section 3 (5)',
    procedure: 'Straight-line trend of the last 12 readings carried hoursAhead forward. A simple stand-in, not a weather model', params: { station: 'string', hoursAhead: 'number' },
    defaults: s => ({ station: s.wx[0]?.key, hoursAhead: 6 }),
    run(s, b) {
      const st = s.wx.find(x => x.key === b.station); if (!st) throw new Error('unknown station; use one of ' + s.wx.map(x => x.key).join(', '));
      const y = st.rows.slice(-12); if (y.length < 2) throw new Error('not enough readings');
      const sl = (y.at(-1).airTemperature - y[0].airTemperature) / (y.length - 1), last = Date.parse(y.at(-1).observationDateTime), step = 15 * 60e3;
      const h = Math.min(48, Math.max(1, Number(b.hoursAhead) || 6));
      return { output: { type: 'SeriesForecast', station: b.station, unit: 'degree Celsius', history: y.map(r => [hhmm(r.observationDateTime), r.airTemperature]), forecast: Array.from({ length: h }, (_, k) => [hhmm(last + (k + 1) * 4 * step), round(y.at(-1).airTemperature + sl * (k + 1) * 4)]) } };
    } },
  { id: 'wx-wind', domain: 'Weather', name: 'Wind map', path: '/weather/windMap', provider: 'Municipal Corporation (demo)',
    inputs: [inp('weather', 'Vector Set', 'RequiresDataSource', 'windSpeed'), inp('weather', 'Hash Map', 'RequiresAdditionalDataSource', 'windDirection')], out: 'Vectors', viz: 'Map Vectors', period: 15, dataPeriodicity: '15 min', provenance: 'City OS paper Section 3 (5)',
    procedure: 'Latest wind speed and direction per station as vectors', params: {}, defaults: () => ({}),
    run(s) { return { output: { type: 'Vectors', vectors: s.wx.map(x => ({ station: x.key, loc: x.loc, speed: x.rows.at(-1)?.windSpeed, direction: x.rows.at(-1)?.windDirection })) } }; } },
  { id: 'wx-heat', domain: 'Weather', name: 'Heat-island map', path: '/weather/heatIsland', provider: 'Municipal Corporation (demo)',
    inputs: [inp('weather', 'Time Series', 'RequiresDataSource', 'airTemperature'), inp('aqm', 'Time Series', 'RequiresAdditionalDataSource', 'TEMPERATURE_MAX')], out: 'MeshGrid', viz: 'Map Raster', period: 60, dataPeriodicity: '15 min', provenance: 'City OS paper Section 3 (5)',
    procedure: 'Interpolated latest temperature minus the city mean, using weather stations and air quality sensors', params: {}, defaults: () => ({}),
    run(s) { const pts = [...s.wx.map(x => ({ loc: x.loc, v: x.rows.at(-1)?.airTemperature })), ...s.aq.map(x => ({ loc: x.loc, v: x.rows.at(-1)?.TEMPERATURE_MAX }))].filter(p => Number.isFinite(p.v)); const m = mean(pts.map(p => p.v)); const g = idwGrid(pts.map(p => ({ ...p, v: p.v - m })), 20, s.bbox); return { output: { type: 'MeshGrid', unit: 'degree Celsius above city mean', cityMean: round(m), min: g.min, max: g.max, cells: g.cells, bbox: g.bbox } }; } },
  { id: 'griev-ward', domain: 'Citizen Grievance', name: 'Ward-wise top grievances', path: '/grievance/wardTop', provider: 'Citizen Services Cell (demo)',
    inputs: [inp('grievview', 'Categorical', 'RequiresDataSource', 'count')], out: 'Table', viz: 'Bar', period: 60, dataPeriodicity: 'daily', provenance: 'City OS paper Section 3 (6)',
    procedure: 'Counts per category in one ward from the grievance counts view (no personal data)', params: { ward: 'string', top: 'number' }, defaults: s => ({ ward: s.wards[2]?.id, top: 3 }),
    run(s, b) { if (!s.wards.some(w => w.id === b.ward)) throw new Error('unknown ward'); return { output: { type: 'Table', ward: b.ward, rows: s.grievCounts.filter(g => g.ward === b.ward).sort((x, y) => y.count - x.count).slice(0, Number(b.top) || 3).map(g => ({ category: g.category, count: g.count })) } }; } },
  { id: 'griev-top', domain: 'Citizen Grievance', name: 'Top grievances', path: '/grievance/top', provider: 'Citizen Services Cell (demo)',
    inputs: [inp('grievview', 'Categorical', 'RequiresDataSource', 'count')], out: 'Table', viz: 'Pie', period: 60, dataPeriodicity: 'daily', provenance: 'City OS paper Section 3 (6)',
    procedure: 'Counts per category across the city', params: { top: 'number' }, defaults: () => ({ top: 5 }),
    run(s, b) { const c = {}; for (const g of s.grievCounts) c[g.category] = (c[g.category] || 0) + g.count; return { output: { type: 'Table', rows: Object.entries(c).sort((x, y) => y[1] - x[1]).slice(0, Number(b.top) || 5).map(([category, count]) => ({ category, count })) } }; } },
];

// Plugged analytics are declarative (no uploaded code runs on the platform): one of these operations
// over one input attribute, grouped by ward. This keeps provider analytics safe to host (City OS Section 4).
export const PLUG_OPS = {
  meanByWard: vals => round(mean(vals)),
  maxByWard: vals => round(Math.max(...vals)),
  minByWard: vals => round(Math.min(...vals)),
  countAboveByWard: (vals, th) => vals.filter(v => v > th).length,
};
export function runPlugged(spec, s, body) {
  const src = spec.inputs.find(i => i.role === 'RequiresDataSource');
  const series = { aqm: s.aq, weather: s.wx, drains: s.drains }[src.group];
  if (!series) throw new Error('plugged analytics can read sensor groups aqm, weather or drains');
  const op = PLUG_OPS[spec.operation]; const th = Number(body.threshold ?? spec.threshold ?? 0);
  const by = {};
  for (const x of series) { const v = x.rows.at(-1)?.[src.attr]; if (Number.isFinite(v)) (by[wardOf(s, x.loc)] ||= []).push(v); }
  const rows = Object.entries(by).map(([ward, vals]) => ({ ward, value: op(vals, th), sensors: vals.length })).sort((a, b) => a.ward.localeCompare(b.ward));
  const alerts = spec.alertAbove != null ? rows.filter(r => r.value > spec.alertAbove).map(r => ({ ward: r.ward, msg: `${spec.name}: ${r.value} in ${r.ward} (above ${spec.alertAbove})` })) : [];
  return { output: { type: 'Table', attribute: src.attr, operation: spec.operation, rows }, alerts };
}
