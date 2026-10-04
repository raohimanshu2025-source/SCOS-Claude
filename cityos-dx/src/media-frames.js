// Synthetic camera pictures (SVG) for the demo traffic cameras: a junction seen from above with a number of
// vehicles that follows the time of day. No real camera or video is involved. Demo data only.
const IST = 5.5 * 3600e3;
export function cameraFrame(name, t, seed = 1) {
  const d = new Date(t + IST), h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const busy = 6 + Math.round(14 * (Math.exp(-((h - 9.5) ** 2) / 3) + Math.exp(-((h - 18.5) ** 2) / 3)));
  let r = (Math.floor(t / 60e3) * 2654435761 + seed * 97) >>> 0;
  const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  const night = h < 6 || h >= 19;
  const cars = Array.from({ length: busy }, () => {
    const horiz = rnd() < 0.55, lane = rnd() < 0.5 ? 0 : 1, pos = 10 + rnd() * 600;
    const [x, y, w, hh] = horiz ? [pos, 158 + lane * 34, 30, 16] : [278 + lane * 34, pos * 0.55, 16, 30];
    const col = ['#d93a2b', '#f2c230', '#2f5f8f', '#e8e8e8', '#1f9d55', '#8e44ad'][Math.floor(rnd() * 6)];
    return `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w}" height="${hh}" rx="4" fill="${col}"/>`;
  }).join('');
  const stamp = d.toISOString().slice(0, 19).replace('T', ' ') + ' IST';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="${night ? '#1d2a33' : '#7d9a5a'}"/><rect y="150" width="640" height="76" fill="#4a4f55"/><rect x="270" width="76" height="360" fill="#4a4f55"/><path d="M0 188H640M308 0V360" stroke="#f2f2f2" stroke-width="2" stroke-dasharray="14 12"/>${cars}<rect width="640" height="28" fill="rgba(0,0,0,.55)"/><text x="10" y="19" font-family="monospace" font-size="14" fill="#fff">${name.replace(/[<&>]/g, '')} · ${stamp}</text><text x="630" y="19" text-anchor="end" font-family="monospace" font-size="14" fill="#f2c230">DEMO · synthetic picture</text><text x="10" y="350" font-family="monospace" font-size="13" fill="#fff">vehicles in view: ${busy}</text></svg>`;
}
