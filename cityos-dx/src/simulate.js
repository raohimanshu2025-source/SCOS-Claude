// Synthetic data simulator: keeps the demo city's sensor streams moving. Demo data only.
import { q } from './db.js';
import { iso, round } from './util.js';
import { cameraFrame } from './media-frames.js';

// Adds one new synthetic reading per sensor so subscriptions and analytics see fresh data.
export function simulateTick(app, now = Date.now()) {
  const { db, catalogue } = app;
  const t = iso(Math.floor(now / 60e3) * 60e3);
  const ins = db.prepare('INSERT OR IGNORE INTO readings (item_id, ts, data) VALUES (?,?,?)');
  const j = (v, a, lo, hi) => Math.min(hi, Math.max(lo, round(v + (Math.random() - 0.5) * a, 2)));
  for (const it of catalogue.all('resourceItem')) {
    if ((it.data?.kind || 'series') !== 'series') continue;
    const last = q.get(db, 'SELECT data FROM readings WHERE item_id=? ORDER BY ts DESC LIMIT 1', it.id); if (!last) continue;
    const d = JSON.parse(last.data); const g = it.doc.resourceServerGroup.value.split('/').pop();
    let n = null;
    if (g === 'aqm') n = { ...d, PM2_5: j(d.PM2_5, 4, 0, 999), CO2_MAX: j(d.CO2_MAX, 8, 0, 5000), TEMPERATURE_MAX: j(d.TEMPERATURE_MAX, 0.4, -20, 50), LASTUPDATEDATETIME: t };
    if (g === 'weather') n = { ...d, airTemperature: j(d.airTemperature, 0.4, -20, 55), relativeHumidity: j(d.relativeHumidity, 2, 0, 100), windSpeed: j(d.windSpeed, 0.5, 0, 60), rainfall: 0, observationDateTime: t };
    if (g === 'drains') n = { ...d, level: j(d.level, 0.04, 0, 5), flow: j(d.flow, 0.08, 0, 20), observationDateTime: t };
    if (g === 'itms') n = { ...d, speed: j(d.speed, 2, 0, 120), observationDateTime: t };
    // Kanpur profile streams (synthetic)
    if (g === 'feeders') n = { ...d, loadMW: d.status === 'on' ? j(d.loadMW, 0.6, 0, 50) : 0, observationDateTime: t };
    if (g === 'pumps') n = { ...d, sumpLevel: j(d.sumpLevel, 0.08, 0, 10), observationDateTime: t };
    if (g === 'junctions') n = { ...d, vehicleCount: Math.round(j(d.vehicleCount, 80, 0, 5000)), avgSpeed: j(d.avgSpeed, 1.5, 2, 120), observationDateTime: t };
    if (g === 'beds') n = { ...d, bedsFree: Math.round(j(d.bedsFree, 3, 0, d.bedsTotal)), observationDateTime: t };
    if (n) ins.run(it.id, t, JSON.stringify(n));
  }
  // a new synthetic camera picture each minute
  for (const it of catalogue.all('resourceItem').filter(i => i.doc.resourceType?.value === 'mediaStream')) {
    q.run(db, 'INSERT OR IGNORE INTO media (item_id, ts, mime, bytes) VALUES (?,?,?,?)', it.id, t, 'image/svg+xml', Buffer.from(cameraFrame(String(it.doc.name.value).replace(/^Traffic camera, /, ''), Date.parse(t))));
  }
  q.run(db, 'DELETE FROM media WHERE ts < ?', iso(now - 86400e3));
  q.run(db, 'DELETE FROM readings WHERE ts < ?', iso(now - 8 * 86400e3));
}

