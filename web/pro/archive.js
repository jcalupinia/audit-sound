// Búsqueda de música en Internet Archive (archive.org) a través del backend del
// mezclador. Igual que la música libre de Jamendo, el navegador habla SIEMPRE con
// nuestro propio servidor (mismo origen), que hace de proxy hacia archive.org: así
// no hay problemas de CORS ni de COEP. Internet Archive NO necesita clave de API.
//
// Endpoints del backend (deploy/pro/server.js):
//   GET /api/archive/search?q=...&limit=N  -> { results:[{id,title,artist,license}] }
//   GET /api/archive/audio?id=<identifier> -> bytes del audio del item
//
// Ojo licencias: Internet Archive aloja material de licencias MUY variadas (dominio
// público, Creative Commons y también "todos los derechos reservados"). Se muestra la
// licencia de cada item cuando está disponible; el auditor/DJ debe verificarla antes
// de usarla públicamente. La búsqueda sin término prioriza colecciones de netlabels.

export function enabled() {
  return typeof window !== 'undefined' && window.AUDIT_SOUND_ARCHIVE === true;
}

export async function search(query, count = 30) {
  const res = await fetch(`/api/archive/search?q=${encodeURIComponent(query || '')}&limit=${count}`);
  const j = await res.json().catch(() => ({ error: 'respuesta no válida del servidor' }));
  if (!res.ok || j.error) throw new Error(j.error || ('HTTP ' + res.status));
  return Array.isArray(j.results) ? j.results : [];
}

export function audioUrl(id) {
  return `/api/archive/audio?id=${encodeURIComponent(id)}`;
}

export async function getBytes(id) {
  const res = await fetch(audioUrl(id));
  if (!res.ok) throw new Error('HTTP ' + res.status + ' al descargar');
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('json')) {
    let msg = 'el servidor devolvió un error en vez de audio';
    try { const j = await res.json(); msg = j.error || msg; } catch (e) {}
    throw new Error(msg);
  }
  return await res.arrayBuffer();
}

export function filename(item) {
  const base = [item.artist, item.title].filter(Boolean).join(' - ') || String(item.id || 'pista');
  return base.replace(/[\/\\:*?"<>|]+/g, '_').slice(0, 120) + '.mp3';
}
