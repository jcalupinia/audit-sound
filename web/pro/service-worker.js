// AUDIT SOUND · Service Worker — PWA instalable + shell sin conexión.
//
// CLAVE DE SEGURIDAD DE AUDIO: el motor WASM necesita aislamiento de origen
// (crossOriginIsolated → SharedArrayBuffer). Por eso este SW **re-añade** las cabeceras
// COOP/COEP/CORP a TODA respuesta que sirve (de red o de caché): si una respuesta de caché
// las perdiera, la página dejaría de estar aislada y el motor no sonaría.
//
// NUNCA cachea la API/proxy (`/api/*`): esos endpoints necesitan red viva (Jamendo,
// Archive, Navidrome, login). El resto (consola, módulos JS, WASM, imágenes) se cachea al
// vuelo, de modo que tras una primera visita en línea la consola abre sin conexión y
// reproduce la biblioteca local (IndexedDB).
const VERSION = 'audit-sound-v1';
const SHELL = [
  '/console.html', '/login.html', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/icon-180.png',
];

const ISO = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};
function withIso(resp) {
  const h = new Headers(resp.headers);
  for (const k in ISO) h.set(k, ISO[k]);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}
function cachePut(req, resp) {
  try { const c = resp.clone(); caches.open(VERSION).then((ch) => ch.put(req, c)).catch(() => {}); } catch (e) {}
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // Solo mismo origen y GET; nunca interceptar la API/proxy (necesita red viva).
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  const isDoc = req.mode === 'navigate' || url.pathname.endsWith('.html');
  if (isDoc) {
    // Documento: red primero (cabeceras frescas), caché como respaldo sin conexión.
    e.respondWith(
      fetch(req).then((r) => { cachePut(req, r); return withIso(r); })
        .catch(() => caches.match(req).then((m) => (m ? withIso(m) : withIso(new Response('Sin conexión', { status: 503 })))))
    );
    return;
  }
  // Resto (JS, WASM, imágenes…): caché primero, red de respaldo, y cachea al vuelo.
  e.respondWith(
    caches.match(req).then((m) => (m ? withIso(m) :
      fetch(req).then((r) => { cachePut(req, r); return withIso(r); })
        .catch(() => withIso(new Response('', { status: 504 })))))
  );
});
