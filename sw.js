/* Service worker — makes the app work offline. Bump VERSION whenever any file changes. */
const VERSION = 'ledger-v2';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'engine.js', 'vault.js', 'backup.js', 'statement.js', 'dashboard.js',
  'libs/xlsx.mini.min.js', 'libs/jspdf.umd.min.js', 'libs/jspdf.plugin.autotable.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => caches.match('index.html')))
  );
});
