/* Service worker mínimo e conservador — shell offline para o RIS/PACS.
 * - Navegações: network-first com fallback ao index cacheado (funciona offline).
 * - Assets estáticos: stale-while-revalidate (atualiza em segundo plano).
 * - /api: NUNCA é cacheado (dados clínicos sempre frescos).
 */
const CACHE = 'ris-pacs-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return; // dados clínicos: sempre rede

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((resp) => { if (resp.ok) cache.put(e.request, resp.clone()); return resp; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
