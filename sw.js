// Cache the site and app so every page opens instantly and the app works with no data:
// SMS still arrives when the internet doesn't.
// Cached copy first (instant), refreshed in the background for next time.
const CACHE = 'alertproof-v6';
const SHELL = [
  './', 'index.html', 'app.html', 'product.html', 'how-it-works.html', 'pricing.html', 'security.html', 'faq.html', 'about.html', 'app.js', 'manifest.webmanifest',
  'lib/money.js', 'lib/ground.js', 'lib/chain.js', 'lib/fingerprint.js', 'lib/prompts.js', 'lib/read.js', 'lib/model.js',
  'lib/store.js', 'lib/formats.js', 'lib/demo.js', 'lib/recorded.js', 'lib/template.js', 'lib/session.js',
  'assets/base.css', 'assets/app.css', 'assets/site.css', 'assets/site.js', 'assets/icon.svg', 'assets/icon-192.png',
  'assets/fonts/inter.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Never touch model calls. Everything else: answer from cache at once, update the cache from the network.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
    const fresh = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit);
    if (hit) { e.waitUntil(fresh); return hit; }
    return fresh;
  }));
});
