// ⚠️  IMPORTANTE: sube ESTE número cada vez que subas un index.html nuevo.
// Es lo que fuerza la actualización en todos los dispositivos. v2 → v3 → v4 …
const CACHE_VERSION = 'pychoras-v3';

const ARCHIVOS = [
  './',
  './index.html',
  './manifest.json'
];

// Instalar: cachear los archivos base de la nueva versión
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(ARCHIVOS).catch(() => {}))
  );
});

// Activar: borrar TODAS las cachés de versiones anteriores
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

// Mensaje desde la app: activar la versión nueva sin esperar
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Estrategia de red:
// - HTML/JS (navegación y el propio index): NETWORK-FIRST → siempre intenta la
//   versión fresca de GitHub; si no hay red, tira de caché. Esto evita que se
//   quede pegada una versión vieja del index.html.
// - Resto: cache-first para que funcione offline.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const esDocumento = req.mode === 'navigate' ||
                      url.pathname.endsWith('/') ||
                      url.pathname.endsWith('index.html');

  if (esDocumento) {
    event.respondWith(
      fetch(req)
        .then(resp => {
          const copia = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copia).catch(() => {}));
          return resp;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cache => cache || fetch(req).then(resp => {
      const copia = resp.clone();
      caches.open(CACHE_VERSION).then(c => c.put(req, copia).catch(() => {}));
      return resp;
    }).catch(() => cache))
  );
});
