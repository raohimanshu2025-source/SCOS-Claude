// Offline support for the public portal (our addition). Network first: when the network answers, the page
// always shows fresh data and a copy is kept; when it does not (a power or network cut), the last copy is shown.
// Only public things are kept: the portal's own files and API reads made WITHOUT a login cookie
// (the portal fetches with credentials 'omit'). The officer console and anything sent with a cookie are never kept.
const CACHE = 'portal-v1';
const SHELL = ['/', '/portal.css', '/sky.css', '/modern.css', '/sky-theme.js', '/portal.js', '/smart.js', '/portal-mark.svg', '/info.html', '/info.js', '/manifest.webmanifest', '/icon-192.png'];
const PUBLIC_API = /^\/(catalogue\/v1\/search|resource\/v1\/(latest|search)|cil\/v1\/(alerts|citizen-alerts|publictransit\/fleetPerformance)|status\/v1|ops\/v1\/transparency|api)(\/|$|\?)/;

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (u.origin !== location.origin) return;
  const shell = r.method === 'GET' && SHELL.includes(u.pathname);
  // the fleet figure is read with POST but is public; it is kept under a GET key of the same address
  const api = PUBLIC_API.test(u.pathname) && r.credentials === 'omit' && (r.method === 'GET' || u.pathname.endsWith('/fleetPerformance'));
  if (!shell && !api) return; // console, logins, uploads and everything else go straight to the network
  const key = r.method === 'GET' ? r : new Request(u.href);
  e.respondWith((async () => {
    try {
      const res = await fetch(r);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    } catch (err) {
      const hit = await caches.match(key, { ignoreVary: true });
      if (hit) { const h = new Headers(hit.headers); h.set('x-offline-copy', '1'); return new Response(await hit.blob(), { status: hit.status, headers: h }); }
      throw err;
    }
  })());
});
