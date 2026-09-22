const CACHE = 'assignment-hub-v38.12.0';
const STATIC = ['/', '/index.html', '/styles.css', '/app.js', '/task-support.js', '/daily-fixes.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting())
));

self.addEventListener('activate', event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  // Keep the small site-specific helpers isolated from the main app file.
  if (url.pathname === '/app.js') {
    event.respondWith(
      Promise.all([
        fetch(event.request).then(response => response.text()),
        fetch('/task-support.js', { cache: 'no-store' }).then(response => response.text()),
        fetch('/daily-fixes.js', { cache: 'no-store' }).then(response => response.text())
      ]).then(([appCode, taskSupport, dailyFixes]) => new Response(`${appCode}\n\n${taskSupport}\n\n${dailyFixes}`, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
      })).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
