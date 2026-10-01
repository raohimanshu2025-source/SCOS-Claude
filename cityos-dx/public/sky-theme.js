/* City sky theme, shared by the portal and the officer console.
   Night in Kanpur gives the whole site a night look; a sunny day adds a soft sun glow; when the demo
   weather stations report rain, gentle rain falls across the page. High contrast turns the effects off,
   and "reduce motion" stops the rain moving (see sky.css).
   Preview: ?sky=dawn|day|dusk|night and ?wx=sun|rain|clear. */
(() => {
  const root = document.documentElement, q = new URLSearchParams(location.search);
  const hour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()));
  const skyOf = h => (h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 16 ? 'day' : h >= 16 && h < 19 ? 'dusk' : 'night');
  let rainMm = null; // from the public weather stations; null until loaded

  function apply() {
    const forcedSky = q.get('sky'), forcedWx = q.get('wx');
    const sky = ['dawn', 'day', 'dusk', 'night'].includes(forcedSky) ? forcedSky : skyOf(hour());
    const wx = ['sun', 'rain', 'clear'].includes(forcedWx) ? forcedWx : rainMm > 0 ? 'rain' : sky === 'night' ? 'clear' : 'sun';
    root.dataset.sky = sky; root.dataset.wx = wx;
    // High contrast keeps its own fixed light colours, so the night look is only used without it.
    if (root.dataset.contrast) delete root.dataset.theme; else root.dataset.theme = sky === 'night' ? 'dark' : 'light';
  }

  // Rain comes from the same public weather data the portal shows, read without a login.
  async function loadWeather() {
    try {
      const get = async u => { const r = await fetch(u, { credentials: 'omit' }); if (!r.ok) throw new Error(u); return r.json(); };
      const cat = await get('/catalogue/v1/search?limit=500');
      const ids = (cat.results || []).filter(d => d.itemType?.value === 'resourceItem' && d.accessPolicyLabel?.value === 'public' && /\/weather$/.test(String(d.resourceServerGroup?.value || ''))).map(d => d.id);
      const rows = await Promise.all(ids.map(id => get('/resource/v1/latest?id=' + encodeURIComponent(id)).catch(() => null)));
      rainMm = Math.max(0, ...rows.filter(Boolean).map(r => (Array.isArray(r.results) ? r.results[0] : r)?.rainfall || 0));
    } catch { rainMm = null; }
    apply();
  }

  // The portal already loads the weather, so it hands the reading over instead of fetching it twice.
  window.citySky = { setRain(mm) { rainMm = mm; apply(); } };
  apply();
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-contrast'] });
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.sky-fx')) document.body.insertAdjacentHTML('afterbegin', '<div class="sky-fx" aria-hidden="true"></div>');
    if (!document.body.dataset.ownWeather) { loadWeather(); setInterval(loadWeather, 10 * 60e3); } // follow the weather while the page stays open
    setInterval(apply, 60e3); // and the clock
  });
})();
