// PycHoras Service Worker — caché + recepción de archivos compartidos + auto-update
// ⚠️  Sube ESTE número cada vez que subas un index.html nuevo:  v6 → v7 → v8 …
const CACHE = 'pychoras-v6';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== 'pychoras-shared').map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── Recepción de archivo compartido (Web Share Target) ──
  // Cuando el usuario comparte un PDF a PycHoras, Android hace POST. GitHub Pages
  // lo rechazaría con "405 Not Allowed", así que el SW DEBE interceptarlo aquí.
  // Aceptamos el POST a cualquier ruta de la app (raíz o index.html) por robustez.
  if (e.request.method === 'POST' && url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const formData = await e.request.formData();
        // El campo se llama 'hoja' (manifest), pero por si acaso buscamos cualquier File.
        let file = formData.get('hoja');
        if (!(file instanceof File)) {
          for (const v of formData.values()) { if (v instanceof File) { file = v; break; } }
        }
        if (file) {
          const tmp = await caches.open('pychoras-shared');
          await tmp.put('shared-file', new Response(file, {
            headers: {
              'Content-Type': file.type || 'application/pdf',
              'X-File-Name': encodeURIComponent(file.name || 'hoja.pdf')
            }
          }));
        }
      } catch (err) { /* si falla, abrimos la app igualmente */ }
      return Response.redirect('./index.html?compartido=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET') return;

  // ── index.html / navegación: SIEMPRE red fresca (evita quedarse pegado en versión vieja) ──
  const esDoc = e.request.mode === 'navigate' ||
                url.pathname.endsWith('/') ||
                url.pathname.endsWith('index.html') ||
                url.pathname.endsWith('.html');
  if (esDoc) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // ── Resto (iconos, manifest): cache-first con fallback a red ──
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      if (resp.ok && url.origin === location.origin) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy).catch(()=>{}));
      }
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
