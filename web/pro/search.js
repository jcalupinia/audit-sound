// AUDIT SOUND — Buscador musical unificado (Etapa A / A2).
//
// Consulta en paralelo las fuentes HABILITADAS (Navidrome/Subsonic, Jamendo "libre",
// Internet Archive y la biblioteca local), normaliza los resultados a una forma común,
// deduplica y clasifica la DISPONIBILIDAD (mezclar / previsualizar / consultar) según
// la matriz de licencias. NO duplica lógica: envuelve los módulos ya existentes
// (subsonic.js, openmusic.js, archive.js, library.js).
//
// Diseño para pruebas: `searchAll(query, {providers})` recibe los proveedores ya
// armados, así el núcleo (paralelo + dedup + timeouts + errores) se prueba con
// proveedores simulados. Los normalizadores por fuente son funciones puras exportadas.

export const AVAIL = { MIX: 'mezclar', PREVIEW: 'previsualizar', LOOKUP: 'consultar' };
const AVAIL_RANK = { mezclar: 3, previsualizar: 2, consultar: 1 };

export const SOURCES = {
  navidrome: { key: 'navidrome', label: 'Navidrome' },
  libre: { key: 'libre', label: 'Libre' },
  archive: { key: 'archive', label: 'Archive' },
  local: { key: 'local', label: 'Local' },
};

// m:ss a partir de segundos (0/invalid → "—").
export function fmtDuration(sec) {
  sec = Math.floor(+sec || 0);
  if (sec <= 0) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// Clave de deduplicación cruzada entre fuentes: título+artista normalizados.
export function normKey(title, artist) {
  const clean = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return clean(artist) + '|' + clean(title);
}

// Clasifica la disponibilidad de un ítem de Internet Archive por su licencia.
// Conservador: solo "mezclar" si la licencia es claramente permisiva; si se desconoce,
// "consultar" (nunca se asume dominio público).
export function archiveAvailability(license) {
  const l = String(license || '').toLowerCase();
  if (!l) return AVAIL.LOOKUP;
  if (/all rights reserved|todos los derechos/.test(l)) return AVAIL.LOOKUP;
  if (/public\s*domain|dominio\s*p|cc0|creativecommons\.org\/publicdomain/.test(l)) return AVAIL.MIX;
  if (/by-nc|by-nd|noncommercial|no-deriv/.test(l)) return AVAIL.PREVIEW;  // CC con restricciones → previsualizar
  if (/\bby(-sa)?\b|creativecommons\.org\/licenses\/by/.test(l)) return AVAIL.MIX;  // CC BY / BY-SA
  return AVAIL.PREVIEW;  // licencia presente pero no clasificada → previsualizar, no mezclar
}

// --- Normalizadores por fuente (puros) ---
export function normNavidrome(song, filename) {
  return {
    source: 'navidrome', sourceLabel: 'Navidrome', id: String(song.id),
    title: song.title || song.id || '', artist: song.artist || '', album: song.album || '',
    duration: +song.duration || 0, license: '', availability: AVAIL.MIX,
    filename: filename || song.title || String(song.id), _raw: song,
  };
}
export function normLibre(song, filename) {
  return {
    source: 'libre', sourceLabel: 'Libre', id: String(song.id),
    title: song.title || '', artist: song.artist || '', album: '',
    duration: +song.duration || 0, license: song.license || 'CC', availability: AVAIL.MIX,
    filename: filename || [song.artist, song.title].filter(Boolean).join(' - ') || String(song.id), _raw: song,
  };
}
export function normArchive(item, filename) {
  return {
    source: 'archive', sourceLabel: 'Archive', id: String(item.id),
    title: item.title || item.id || '', artist: item.artist || '', album: '',
    duration: +item.duration || 0, license: item.license || '',
    availability: archiveAvailability(item.license),
    filename: filename || [item.artist, item.title].filter(Boolean).join(' - ') || String(item.id), _raw: item,
  };
}
export function normLocal(track) {
  // La biblioteca local guarda el nombre completo (p. ej. "Artista - Título.ext").
  const name = track.name || String(track.id || '');
  let artist = '', title = name;
  const dash = name.indexOf(' - ');
  if (dash > 0) { artist = name.slice(0, dash); title = name.slice(dash + 3); }
  title = title.replace(/\.[a-z0-9]{2,5}$/i, '');
  return {
    source: 'local', sourceLabel: 'Local', id: String(track.id),
    title, artist, album: '', duration: +track.duration || 0,
    license: '', availability: AVAIL.MIX, bpm: +track.bpm || 0, key: (track.key ?? -1) | 0,
    filename: name, _raw: track,
  };
}

// Deduplicación: exacta por (source,id) y cruzada por título+artista. Entre duplicados
// cruzados se conserva el de MAYOR disponibilidad (mezclar > previsualizar > consultar);
// se anota en `alsoIn` las otras fuentes donde aparece.
export function dedupe(results) {
  const byExact = new Map();   // source::id → result (quita duplicados exactos)
  for (const r of results) {
    const ek = r.source + '::' + r.id;
    if (!byExact.has(ek)) byExact.set(ek, r);
  }
  const byCross = new Map();   // normKey → result elegido
  for (const r of byExact.values()) {
    const ck = normKey(r.title, r.artist);
    const prev = byCross.get(ck);
    if (!prev) { r.alsoIn = []; byCross.set(ck, r); continue; }
    // conserva el de mayor disponibilidad; el otro queda como "alsoIn"
    const keep = AVAIL_RANK[r.availability] > AVAIL_RANK[prev.availability] ? r : prev;
    const drop = keep === r ? prev : r;
    keep.alsoIn = (keep.alsoIn || []).concat(drop.source, drop.alsoIn || []);
    byCross.set(ck, keep);
  }
  return Array.from(byCross.values());
}

// Timeout por proveedor: rechaza si tarda más de ms (el fetch subyacente se ignora).
export function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + (label || '') + ' (' + ms + 'ms)')), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); });
  });
}

// Búsqueda unificada. `providers` = [{source,label,enabled,search(query,perSource)->[normalized]}].
// Devuelve { results, errors, bySource } sin lanzar: un proveedor que falle no tumba al resto.
export async function searchAll(query, opts = {}) {
  const providers = (opts.providers || []).filter((p) => p && (p.enabled === undefined || p.enabled));
  const perSource = opts.perSource || 20;
  const timeoutMs = opts.timeoutMs == null ? 8000 : opts.timeoutMs;
  const only = opts.only;  // si se pasa, limita a esas fuentes (filtro por fuente)
  const active = only && only.length ? providers.filter((p) => only.includes(p.source)) : providers;

  const settled = await Promise.allSettled(active.map((p) =>
    withTimeout(Promise.resolve().then(() => p.search(query, perSource)), timeoutMs, p.label || p.source)
      .then((rows) => ({ source: p.source, rows: Array.isArray(rows) ? rows : [] }))));

  const errors = [], bySource = {};
  let flat = [];
  settled.forEach((s, i) => {
    const p = active[i];
    if (s.status === 'fulfilled') {
      bySource[p.source] = s.value.rows.length;
      flat = flat.concat(s.value.rows);
    } else {
      bySource[p.source] = -1;
      errors.push({ source: p.source, label: p.label || p.source, error: String((s.reason && s.reason.message) || s.reason) });
    }
  });

  const results = dedupe(flat);
  return { results, errors, bySource, query: String(query || '') };
}
