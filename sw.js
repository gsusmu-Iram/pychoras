// PycHoras Service Worker — caché offline + recepción de archivos compartidos
const CACHE = 'pychoras-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── Recepción de archivo compartido (Web Share Target) ──
  // Cuando el usuario comparte un PDF a PycHoras, Android hace POST a index.html.
  if (e.request.method === 'POST' && url.pathname.endsWith('index.html')) {
    e.respondWith((async () => {
      try {
        const formData = await e.request.formData();
        const file = formData.get('hoja');
        if (file) {
          // Guardar el archivo en un cache temporal para que la app lo recoja
          const tmp = await caches.open('pychoras-shared');
          await tmp.put('shared-file', new Response(file, {
            headers: {
              'Content-Type': file.type || 'application/pdf',
              'X-File-Name': encodeURIComponent(file.name || 'hoja.pdf')
            }
          }));
        }
      } catch (err) { /* si falla, abrimos la app igualmente */ }
      // Redirigir a la app con una marca para que sepa que hay un archivo compartido
      return Response.redirect('./index.html?compartido=1', 303);
    })());
    return;
  }

  // ── Caché normal: cache-first con fallback a red ──
  if (e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
        // Cachear nuevas respuestas GET del mismo origen
        if (resp.ok && url.origin === location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => caches.match('./index.html')))
    );
  }
});
