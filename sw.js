// ⚠️  Sube ESTE número cada vez que subas un index.html nuevo:  v4 → v5 → v6 …
const CACHE_VERSION = 'pychoras-v5';

// Solo cacheamos iconos/manifest (recursos que casi nunca cambian).
// El index.html NUNCA se cachea: siempre se pide fresco a la red.
const ARCHIVOS_ESTATICOS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(ARCHIVOS_ESTATICOS).catch(() => {}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(nombres =>
      Promise.all(
        nombres
          .filter(n => n !== CACHE_VERSION && n !== 'pychoras-shared')
          .map(n => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const esDocumento =
    req.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('index.html') ||
    url.pathname.endsWith('.html');

  // DOCUMENTO (index.html): SIEMPRE red, nunca caché. Solo cae a caché sin internet.
  if (esDocumento) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Recursos estáticos: caché primero, red como respaldo.
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(resp => {
      const copia = resp.clone();
      caches.open(CACHE_VERSION).then(c => c.put(req, copia).catch(() => {}));
      return resp;
    }).catch(() => hit))
  );
});
