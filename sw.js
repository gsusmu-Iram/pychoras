// PycHoras Service Worker — caché + recepción de archivos compartidos + auto-update
// ⚠️  Sube ESTE número cada vez que subas un index.html nuevo:  v6 → v7 → v8 …
const CACHE = 'pychoras-v9';
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
      let bytesRecibidos = -1;
      try {
        // Copia en crudo del envío ANTES de nada (formData() consume el cuerpo)
        let crudo = null;
        try {
          crudo = await e.request.clone().arrayBuffer();
          bytesRecibidos = crudo.byteLength;
        } catch (_) {}

        // 1) Intento normal
        let file = null;
        try {
          const formData = await e.request.formData();
          file = formData.get('hoja');
          if (!(file instanceof File)) {
            for (const v of formData.values()) { if (v instanceof File) { file = v; break; } }
          }
        } catch (_) { /* en algunos Chrome falla: seguimos a mano */ }

        // 2) Si falló, descifrar el envío a mano desde los bytes en crudo
        if (!(file instanceof File) && crudo && crudo.byteLength > 0) {
          file = _leerMultipartAMano(crudo, e.request.headers.get('content-type') || '');
        }

        const tmp = await caches.open('pychoras-shared');
        await tmp.delete('shared-error');
        if (!(file instanceof File)) {
          await tmp.put('shared-error', new Response(
            'el envío llegó sin archivo (' + bytesRecibidos + ' bytes)'));
        } else {
          // Algunas apps mandan el PDF como tipo genérico: si el nombre es .pdf, tratarlo como PDF
          const nom = (file.name || '').toLowerCase();
          const tipo = (nom.endsWith('.pdf') || !file.type || file.type === 'application/octet-stream')
                       && !(file.type || '').startsWith('image/') ? 'application/pdf' : file.type;
          await tmp.put('shared-file', new Response(file, {
            headers: {
              'Content-Type': tipo,
              'X-File-Name': encodeURIComponent(file.name || 'hoja.pdf')
            }
          }));
        }
      } catch (err) {
        // Apuntar el error para que la app lo muestre (antes se perdía en silencio)
        try {
          const tmp = await caches.open('pychoras-shared');
          await tmp.put('shared-error', new Response(
            String((err && err.message) || err) + ' (' + bytesRecibidos + ' bytes)'));
        } catch (_) {}
      }
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


// ── Lector manual de envíos multipart ────────────────────────
// Algunas versiones de Chrome entregan el archivo compartido pero request.formData()
// devuelve vacío. Aquí leemos los bytes en crudo y sacamos el archivo nosotros.
function _leerMultipartAMano(buffer, contentType) {
  try {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
    if (!m) return null;
    const boundary = '--' + (m[1] || m[2]).trim();
    const bytes = new Uint8Array(buffer);
    const bBytes = new TextEncoder().encode(boundary);

    // Localizar todas las separaciones
    const cortes = [];
    for (let i = 0; i <= bytes.length - bBytes.length; i++) {
      let ok = true;
      for (let j = 0; j < bBytes.length; j++) {
        if (bytes[i + j] !== bBytes[j]) { ok = false; break; }
      }
      if (ok) { cortes.push(i); i += bBytes.length - 1; }
    }
    if (cortes.length < 2) return null;

    const dec = new TextDecoder();
    for (let k = 0; k < cortes.length - 1; k++) {
      const ini = cortes[k] + bBytes.length;
      const fin = cortes[k + 1];
      if (fin <= ini) continue;
      const trozo = bytes.subarray(ini, fin);

      // Separar cabeceras del contenido: línea en blanco (\r\n\r\n)
      let sep = -1;
      for (let i = 0; i < trozo.length - 3; i++) {
        if (trozo[i] === 13 && trozo[i+1] === 10 && trozo[i+2] === 13 && trozo[i+3] === 10) { sep = i; break; }
      }
      if (sep < 0) continue;

      const cabeceras = dec.decode(trozo.subarray(0, sep));
      if (!/filename\s*=/i.test(cabeceras)) continue;   // este trozo no es un archivo

      const fn = /filename\s*=\s*"([^"]*)"/i.exec(cabeceras);
      let nombre = (fn && fn[1]) ? fn[1] : 'hoja.pdf';
      const ct = /content-type\s*:\s*([^\r\n]+)/i.exec(cabeceras);
      let tipo = ct ? ct[1].trim() : '';

      // Quitar el \r\n final que precede a la siguiente separación
      let finCuerpo = fin - cortes[k] - bBytes.length;
      let ini2 = sep + 4;
      let fin2 = trozo.length;
      if (fin2 >= 2 && trozo[fin2-2] === 13 && trozo[fin2-1] === 10) fin2 -= 2;
      if (fin2 <= ini2) continue;

      const nomL = nombre.toLowerCase();
      if (nomL.endsWith('.pdf') || !tipo || tipo === 'application/octet-stream') {
        if (!tipo.startsWith('image/')) tipo = 'application/pdf';
      }
      const datos = trozo.slice(ini2, fin2);
      return new File([datos], nombre, { type: tipo });
    }
    return null;
  } catch (_) {
    return null;
  }
}
