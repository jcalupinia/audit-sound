// Búsqueda de música LIBRE (Creative Commons) a través del backend del mezclador.
// El navegador habla SIEMPRE con nuestro propio servidor (mismo origen), que hace
// de proxy hacia Jamendo: así no hay problemas de CORS ni de COEP, y la clave de
// API (client_id) vive solo en el servidor (variable de entorno de Coolify).
//
// Endpoints del backend (deploy/pro/server.js):
//   GET /api/openmusic/search?q=...&limit=N  -> JSON { results:[{id,title,artist,audio,duration,license}] }
//   GET /api/openmusic/audio?url=<url de audio de la fuente>  -> bytes del audio (host en lista blanca)
//
// window.AUDIT_SOUND_OPENMUSIC (de config.js) indica si el backend tiene clave configurada.

export function enabled() {
  return typeof window !== 'undefined' && window.AUDIT_SOUND_OPENMUSIC === true;
}

export async function search(query, count = 25, signal) {
  const res = await fetch(`/api/openmusic/search?q=${encodeURIComponent(query || '')}&limit=${count}`, signal ? { signal } : undefined);
  const j = await res.json().catch(() => ({ error: 'respuesta no válida del servidor' }));
  if (!res.ok || j.error) throw new Error(j.error || ('HTTP ' + res.status));
  return Array.isArray(j.results) ? j.results : [];
}

// URL (de nuestro backend) para reproducir/descargar el audio de una pista.
export function audioUrl(trackAudio) {
  return `/api/openmusic/audio?url=${encodeURIComponent(trackAudio)}`;
}

// Descarga los bytes del audio a través del proxy del backend.
export async function getBytes(trackAudio) {
  const res = await fetch(audioUrl(trackAudio));
  if (!res.ok) throw new Error('HTTP ' + res.status + ' al descargar');
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('json')) {
    let msg = 'el servidor devolvió un error en vez de audio';
    try { const j = await res.json(); msg = j.error || msg; } catch (e) {}
    throw new Error(msg);
  }
  return await res.arrayBuffer();
}

// Nombre de archivo sugerido para una pista.
export function filename(track) {
  const base = [track.artist, track.title].filter(Boolean).join(' - ') || String(track.id || 'pista');
  return base.replace(/[\/\\:*?"<>|]+/g, '_') + '.mp3';
}
