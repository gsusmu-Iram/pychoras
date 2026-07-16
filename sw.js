// ⚠️  Sube ESTE número cada vez que subas un index.html nuevo:  v5 → v6 → v7 …
const CACHE_VERSION = 'pychoras-v5';

// Solo cacheamos iconos/manifest. El index.html NUNCA se cachea (siempre red).
const ARCHIVOS_ESTATICOS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(ARCHIVOS_ESTATICOS).catch(() => {}))
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
  const url = new URL(req.url);

  // ── WEB SHARE TARGET ──────────────────────────────────────────
  // Cuando compartes una hoja diaria a PycHoras, Android envía un POST con el
  // archivo. GitHub Pages rechaza los POST con "405 Not Allowed", así que el SW
  // TIENE que interceptarlo aquí: guarda el PDF en caché y redirige a la app.
  // (Se detecta por método POST hacia una ruta de esta app, no por URL exacta.)
  if (req.method === 'POST' && url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const formData = await req.formData();
        // Buscar el primer archivo en cualquier campo del formulario
        let file = null;
        for (const value of formData.values()) {
          if (value instanceof File) { file = value; break; }
        }
        if (file) {
          const cache = await caches.open('pychoras-shared');
          const headers = new Headers();
          headers.set('Content-Type', file.type || 'application/pdf');
          headers.set('X-File-Name', encodeURIComponent(file.name || 'hoja.pdf'));
          await cache.put('shared-file', new Response(file, { headers }));
        }
      } catch (e) { /* si algo falla, igualmente redirigimos a la app */ }
      // Redirigir a la app con la marca ?compartido=1 (la app recoge el archivo del caché)
      return Response.redirect('./index.html?compartido=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

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
