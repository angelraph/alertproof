// Cache the app so a trader can check alerts with no data: SMS still arrives when the internet doesn't.
const CACHE = 'alertproof-v1';
const SHELL = [
  './', 'index.html', 'app.html', 'app.js', 'manifest.webmanifest',
  'lib/money.js', 'lib/ground.js', 'lib/chain.js', 'lib/fingerprint.js', 'lib/prompts.js', 'lib/read.js', 'lib/model.js',
  'lib/store.js', 'lib/formats.js', 'lib/demo.js', 'lib/recorded.js',
  'assets/base.css', 'assets/app.css', 'assets/site.css', 'assets/icon.svg', 'assets/icon-192.png',
  'assets/fonts/inter.woff2', 'assets/fonts/fraunces.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (fresh when online), cache when offline. Never touch model calls.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
