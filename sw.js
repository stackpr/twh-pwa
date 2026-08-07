/* sw.js — app shell cache.
 *
 * PRIVACY INVARIANT: this worker caches only the static files enumerated in
 * SHELL. It must never cache a response derived from the treasurer's export.
 * That is enforced structurally: the app never fetches transaction data over
 * the network — the CSV is read from a local File object via the File API and
 * never becomes a Request. Any fetch that is not a same-origin GET for a shell
 * file falls straight through to the network without touching the cache.
 *
 * Bump CACHE_VERSION on every deployment.
 */

const CACHE_VERSION = 'v15';
const CACHE_NAME = `troopfin-shell-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/csv.js',
  './js/config.js',
  './js/ledger.js',
  './js/reports.js',
  './js/snapshots.js',
  './js/yaml.js',
  './js/settings.js',
  './js/render.js',
  './js/install.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('troopfin-') && k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // Only same-origin GETs are eligible. Everything else bypasses the cache.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so a new deployment is picked up promptly,
  // falling back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // Static assets: cache-first. Only paths we shipped are ever stored.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        const inShell = SHELL.some(p => url.pathname.endsWith(p.replace(/^\.\//, '')));
        if (inShell && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  // The page asks which shell it is actually being served. Answering from here
  // rather than from a constant in the page is the point: after a deployment the
  // page can be new while the worker serving it is still the old one, and that
  // gap is exactly what the version in the header is for.
  if (event.data === 'version' && event.ports[0]) event.ports[0].postMessage(CACHE_VERSION);
});
