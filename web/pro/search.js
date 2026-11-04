// AUDIT SOUND — Buscador musical unificado (Etapa A / A2, correcciones A4.2).
//
// Consulta en paralelo las fuentes HABILITADAS, normaliza, deduplica SIN fusionar
// versiones distintas (remix/live/remaster/álbum/duración) y clasifica la
// DISPONIBILIDAD por LICENCIA DE CADA PISTA (mezclar / previsualizar / consultar),
// con tratamiento conservador de licencias desconocidas y detección de NC/ND.
// Soporta cancelación de búsquedas obsoletas (AbortController) y límites de memoria.
// No duplica lógica: envuelve subsonic.js, openmusic.js, archive.js, library.js.

export const AVAIL = { MIX: 'mezclar', PREVIEW: 'previsualizar', LOOKUP: 'consultar' };
const AVAIL_RANK = { mezclar: 3, previsualizar: 2, consultar: 1 };

export const SOURCES = {
  navidrome: { key: 'navidrome', label: 'Navidrome' },
  libre: { key: 'libre', label: 'Libre' },
  archive: { key: 'archive', label: 'Archive' },
  local: { key: 'local', label: 'Local' },
};

const MAX_TOTAL_RESULTS = 200;  // tope de memoria/resultados

export function fmtDuration(sec) {
  sec = Math.floor(+sec || 0);
  if (sec <= 0) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

const strip = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Etiqueta de versión/variante de una grabación (remix, en vivo, remaster, etc.).
export function versionTag(title) {
  const t = strip(title);
  const tags = [];
  if (/\bremix\b|\brmx\b/.test(t)) tags.push('remix');
  if (/\blive\b|\ben vivo\b|\bdirecto\b|\bconcert\b/.test(t)) tags.push('live');
  if (/\bremaster(ed|izad[oa])?\b/.test(t)) tags.push('remaster');
  if (/\bacoustic\b|\bac[uú]stic[oa]\b|\bunplugged\b/.test(t)) tags.push('acoustic');
  if (/\bradio edit\b|\bradio mix\b/.test(t)) tags.push('radio');
  if (/\bextended\b|\bclub mix\b/.test(t)) tags.push('extended');
  if (/\binstrumental\b/.test(t)) tags.push('instrumental');
  if (/\bkaraoke\b/.test(t)) tags.push('karaoke');
  // "feat." no es una versión distinta de la grabación → no cuenta.
  return tags.sort().join(',');
}

// Título base sin la coletilla de versión ni paréntesis/corchetes de variante.
function titleBase(title) {
  return strip(title)
    .replace(/[\(\[].*?(remix|live|en vivo|remaster|acoustic|ac[uú]stic|unplugged|radio|extended|club mix|instrumental|karaoke|version|versi[oó]n).*?[\)\]]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normKey(title, artist) { return strip(artist).replace(/[^a-z0-9]+/g, ' ').trim() + '|' + titleBase(title); }

// Clasifica una licencia (CC u otra). Devuelve { availability, restrictions, label }.
// `unknownDefault` es la disponibilidad cuando la licencia es desconocida/ausente
// (conservador: consultar para Archive; previsualizar para Jamendo, que es curado CC).
export function classifyLicense(license, unknownDefault) {
  const l = strip(license);
  const out = { availability: unknownDefault, restrictions: [], label: license ? String(license) : '' };
  if (!l) return out;
  if (/all rights reserved|todos los derechos/.test(l)) { out.availability = AVAIL.LOOKUP; out.label = 'Todos los derechos reservados'; return out; }
  if (/public\s*domain|dominio\s*p|cc0|publicdomain/.test(l)) { out.availability = AVAIL.MIX; out.label = 'Dominio público / CC0'; return out; }
  const nc = /by-nc|noncommercial|no\s*comercial/.test(l);
  const nd = /by-nd|no-?deriv|sin\s*derivad/.test(l);
  if (nc) out.restrictions.push('NC');
  if (nd) out.restrictions.push('ND');
  if (nc || nd) { out.availability = AVAIL.PREVIEW; out.label = 'CC ' + out.restrictions.join('-'); return out; }
  if (/\bby(-sa)?\b|licenses\/by/.test(l)) { out.availability = AVAIL.MIX; out.label = /by-sa|by\/sa/.test(l) ? 'CC BY-SA' : 'CC BY'; return out; }
  return out;  // licencia presente pero no clasificada → unknownDefault (conservador)
}
// Compat: disponibilidad de Internet Archive (desconocida → consultar).
export function archiveAvailability(license) { return classifyLicense(license, AVAIL.LOOKUP).availability; }

// --- Normalizadores por fuente (puros) ---
export function normNavidrome(song, filename) {
  return {
    source: 'navidrome', sourceLabel: 'Navidrome', id: String(song.id),
    title: song.title || song.id || '', artist: song.artist || '', album: song.album || '',
    duration: +song.duration || 0, license: '', licenseLabel: 'Biblioteca propia',
    availability: AVAIL.MIX, restrictions: [],
    filename: filename || song.title || String(song.id), _raw: song,
  };
}
export function normLibre(song, filename) {
  // A4.2-A: disponibilidad POR LICENCIA de cada pista (no todas "mezclar").
  const cl = classifyLicense(song.license, AVAIL.PREVIEW);  // Jamendo desconocida → previsualizar
  return {
    source: 'libre', sourceLabel: 'Libre', id: String(song.id),
    title: song.title || '', artist: song.artist || '', album: song.album || '',
    duration: +song.duration || 0, license: song.license || '', licenseLabel: cl.label || 'CC',
    availability: cl.availability, restrictions: cl.restrictions,
    filename: filename || [song.artist, song.title].filter(Boolean).join(' - ') || String(song.id), _raw: song,
  };
}
export function normArchive(item, filename) {
  const cl = classifyLicense(item.license, AVAIL.LOOKUP);  // Archive desconocida → consultar
  return {
    source: 'archive', sourceLabel: 'Archive', id: String(item.id),
    title: item.title || item.id || '', artist: item.artist || '', album: '',
    duration: +item.duration || 0, license: item.license || '', licenseLabel: cl.label,
    availability: cl.availability, restrictions: cl.restrictions,
    filename: filename || [item.artist, item.title].filter(Boolean).join(' - ') || String(item.id), _raw: item,
  };
}
export function normLocal(track) {
  const name = track.name || String(track.id || '');
  let artist = '', title = name;
  const dash = name.indexOf(' - ');
  if (dash > 0) { artist = name.slice(0, dash); title = name.slice(dash + 3); }
  title = title.replace(/\.[a-z0-9]{2,5}$/i, '');
  return {
    source: 'local', sourceLabel: 'Local', id: String(track.id),
    title, artist, album: '', duration: +track.duration || 0,
    license: '', licenseLabel: 'Biblioteca propia', availability: AVAIL.MIX, restrictions: [],
    bpm: +track.bpm || 0, key: (track.key ?? -1) | 0, filename: name, _raw: track,
  };
}

// ¿Son la MISMA grabación? Mismo artista + título base + etiqueta de versión, y
// álbum y duración COMPATIBLES (iguales o desconocidos). No fusiona remix/live/
// álbumes/duraciones distintas (A4.2-B).
function sameRecording(a, b) {
  if (normKey(a.title, a.artist) !== normKey(b.title, b.artist)) return false;
  if (versionTag(a.title) !== versionTag(b.title)) return false;
  const al = strip(a.album), bl = strip(b.album);
  if (al && bl && al !== bl) return false;                      // álbumes distintos → distinta
  if (a.duration && b.duration && Math.abs(a.duration - b.duration) > 3) return false;  // duración distinta
  return true;
}

export function dedupe(results) {
  // 1) Exacta por (source,id).
  const exact = new Map();
  for (const r of results) { const k = r.source + '::' + r.id; if (!exact.has(k)) exact.set(k, r); }
  // 2) Cruzada por "misma grabación" (conservadora). Se conserva la de mayor
  //    disponibilidad; las demás fuentes quedan en alsoIn.
  const kept = [];
  for (const r of exact.values()) {
    let merged = false;
    for (const k of kept) {
      if (sameRecording(k, r)) {
        const better = AVAIL_RANK[r.availability] > AVAIL_RANK[k.availability] ? r : k;
        const worse = better === r ? k : r;
        const idx = kept.indexOf(k);
        better.alsoIn = Array.from(new Set((k.alsoIn || []).concat(r.alsoIn || [], worse.source)));
        kept[idx] = better;
        merged = true;
        break;
      }
    }
    if (!merged) { r.alsoIn = r.alsoIn || []; kept.push(r); }
  }
  return kept;
}

// Timeout por proveedor (independiente): rechaza si tarda más de ms.
export function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout ' + (label || '') + ' (' + ms + 'ms)')), ms);
    Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); },
                                  (e) => { clearTimeout(t); reject(e); });
  });
}

// Búsqueda unificada. opts: { providers, only, perSource, timeoutMs, signal, maxTotal }.
// `signal` (AbortSignal) permite cancelar: se pasa a los proveedores que lo soporten
// y, si se aborta, searchAll rechaza para que el llamador descarte resultados obsoletos.
export async function searchAll(query, opts = {}) {
  const providers = (opts.providers || []).filter((p) => p && (p.enabled === undefined || p.enabled));
  const perSource = opts.perSource || 20;
  const timeoutMs = opts.timeoutMs == null ? 8000 : opts.timeoutMs;
  const maxTotal = opts.maxTotal || MAX_TOTAL_RESULTS;
  const only = opts.only;
  const signal = opts.signal;
  const active = only && only.length ? providers.filter((p) => only.includes(p.source)) : providers;
  if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');

  const settled = await Promise.allSettled(active.map((p) =>
    withTimeout(Promise.resolve().then(() => p.search(query, perSource, signal)), timeoutMs, p.label || p.source)
      .then((rows) => ({ source: p.source, rows: Array.isArray(rows) ? rows : [] }))));

  if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');

  const errors = [], bySource = {};
  let flat = [];
  settled.forEach((s, i) => {
    const p = active[i];
    if (s.status === 'fulfilled') { bySource[p.source] = s.value.rows.length; flat = flat.concat(s.value.rows); }
    else { bySource[p.source] = -1; errors.push({ source: p.source, label: p.label || p.source, error: String((s.reason && s.reason.message) || s.reason) }); }
  });

  const results = dedupe(flat).slice(0, maxTotal);  // límite de memoria
  return { results, errors, bySource, query: String(query || '') };
}
