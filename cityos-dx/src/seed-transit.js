// Multimodal transit data for City OS Figure 7: a metro line and a suburban rail line (timetables) and
// occupancy readings for bus routes and both rail lines. Shared by the demo city and the Kanpur profile.
// All values are synthetic; station positions are approximate.
const IST = 5.5 * 3600e3;
const istHour = t => new Date(t + IST).getUTCHours() + new Date(t + IST).getUTCMinutes() / 60;

export function seedTransit({ group, res, ingest, times, rnd, round, provider, metro, suburban, busRoutes, lineNames }) {
  group('railtt', 'Metro and suburban rail timetables', provider, 'rs1', 'railTimetable', 'openAPI');
  group('occupancy', 'Bus and rail occupancy', provider, 'rs1', 'transitOccupancy', 'asyncAPI');
  const lines = [['metro', lineNames.metro, metro, 4, 7, '06:00', '22:00', 'M'], ['suburban', lineNames.suburban, suburban, 6, 30, '05:30', '22:30', 'R']];
  for (const [mode, line, stations, mins, headway, first, last, pre] of lines) {
    const id = res({ key: `${mode}-timetable`, grp: 'railtt', name: `${line} timetable`, desc: `Stations, running time from the first station and service hours of the ${mode} line (synthetic, approximate positions).`, tags: ['transport', mode, 'timetable'], rtype: 'table', label: 'public' });
    ingest(id, stations.map(([name, loc], i) => ({ line, mode, stationId: `${pre}${i + 1}`, name, location: { type: 'Point', coordinates: loc }, seq: i + 1, runMinutes: i * mins, firstTrain: first, lastTrain: last, headwayMinutes: headway })));
  }
  // Occupancy: morning and evening peaks in Indian Standard Time, plus noise.
  const shape = (t, peak) => { const h = istHour(t); return 25 + peak * (Math.exp(-((h - 9.5) ** 2) / 2) + 0.9 * Math.exp(-((h - 18.5) ** 2) / 2.5)) + (h < 6 || h > 22 ? -15 : 0); };
  for (const [mode, line, peak] of [...busRoutes.map(r => ['bus', r, 70]), ['metro', lineNames.metro, 85], ['suburban', lineNames.suburban, 95]]) {
    const id = res({ key: `occ-${mode}-${String(line).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, grp: 'occupancy', name: `Occupancy, ${line}`, desc: `Average occupancy of ${mode} vehicles on ${line}, every 15 minutes (synthetic).`, tags: ['transport', mode, 'occupancy'], rtype: 'messageStream', label: 'public' });
    ingest(id, times.map(t => ({ line, mode, occupancyPercent: Math.max(3, round(shape(t, peak) + (rnd() - 0.5) * 8, 0)), observationDateTime: new Date(t).toISOString() })));
  }
}
