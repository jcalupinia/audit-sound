// AUDIT SOUND · Fase 1 — Buscador de la consola sobre el motor real.
// Engancha la barra "Buscar en la biblioteca" (overlay sobre tu imagen) al buscador
// unificado (search.js), que envuelve las 4 fuentes: Navidrome (subsonic.js),
// música libre/Jamendo (openmusic.js), Internet Archive (archive.js) y la biblioteca
// local persistente (library.js, IndexedDB). Cada resultado se carga al deck A o B
// con el MISMO motor WASM (bridge.load). No duplica lógica: reutiliza los módulos.
import * as SEARCH from './search.js';
import * as OM from './openmusic.js';
import * as IA from './archive.js';
import * as LIB from './library.js';
import { SubsonicClient, loadConfig } from './subsonic.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// setup({ bridge, ensureStarted, onStatus }) -> { refreshLocal }
export function setupSearch({ bridge, ensureStarted, onStatus }) {
  const $ = (id) => document.getElementById(id);
  const input = $('buscar');
  const panel = $('resultados');
  if (!input || !panel) return { refreshLocal: async () => {} };
  const status = (t, err) => { if (onStatus) onStatus(t, err); };

  let libRows = [];
  const refreshLocal = async () => { try { if (LIB.available()) libRows = (await LIB.listTracks()) || []; } catch (e) {} };
  refreshLocal();

  // Navidrome solo si hay configuración guardada (url/usuario/token).
  let nd = null;
  try { const c = loadConfig(); if (c && c.url) nd = new SubsonicClient(c); } catch (e) {}

  const localSearch = (q) => {
    const ql = String(q || '').toLowerCase();
    return libRows.filter((t) => !ql || (t.name || '').toLowerCase().includes(ql)).map(SEARCH.normLocal);
  };

  const providers = () => [
    nd && {
      source: 'navidrome', label: 'Navidrome', enabled: true,
      search: async (q, n, s) => (await nd.search(q, n, s)).map((x) => SEARCH.normNavidrome(x, x.title || x.id)),
    },
    { source: 'libre', label: 'Libre', enabled: OM.enabled(),
      search: async (q, n, s) => (await OM.search(q, n, s)).map((x) => SEARCH.normLibre(x, OM.filename(x))) },
    { source: 'archive', label: 'Archive', enabled: IA.enabled(),
      search: async (q, n, s) => (await IA.search(q, n, s)).map((x) => SEARCH.normArchive(x, IA.filename(x))) },
    { source: 'local', label: 'Local', enabled: true, search: async (q) => localSearch(q) },
  ].filter(Boolean);

  const bytesOf = (r) => {
    if (r.source === 'navidrome' && nd) return nd.getBytes(r.id);
    if (r.source === 'libre') return OM.getBytes(r._raw.audio);
    if (r.source === 'archive') return IA.getBytes(r.id);
    return LIB.getBytes(r.id);
  };

  let epoch = 0, abort = null, results = [];

  async function doSearch() {
    const q = input.value.trim();
    const e = ++epoch;
    if (abort) { try { abort.abort(); } catch (_) {} }   // cancela la búsqueda anterior (A4.2-C)
    const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    abort = ac;
    panel.style.display = 'block';
    panel.innerHTML = '<div class="rmsg">buscando…</div>';
    let out;
    try {
      out = await SEARCH.searchAll(q, { providers: providers(), perSource: 25, timeoutMs: 9000, signal: ac && ac.signal });
    } catch (err) {
      if (err && err.name === 'AbortError') return;    // búsqueda cancelada: no pintes
      panel.innerHTML = '<div class="rmsg err">error de búsqueda</div>';
      return;
    }
    if (e !== epoch) return;                             // respuesta obsoleta: descártala
    results = out.results;
    render(out);
  }

  function render(out) {
    panel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'rhead';
    const ok = [];
    for (const s in out.bySource) if (out.bySource[s] >= 0) ok.push(out.bySource[s] + ' ' + s);
    const errTxt = (out.errors && out.errors.length) ? ' · ' + out.errors.map((x) => x.label + ': ' + (/timeout|abort/i.test(x.error) ? 'tardó' : 'error')).join(', ') : '';
    head.innerHTML = `<span>${results.length} resultado(s)${ok.length ? ' · ' + esc(ok.join(', ')) : ''}${esc(errTxt)}</span>`;
    const close = document.createElement('button');
    close.className = 'rclose'; close.textContent = '✕'; close.title = 'cerrar';
    close.addEventListener('click', () => { panel.style.display = 'none'; });
    head.appendChild(close);
    panel.appendChild(head);
    if (!results.length) {
      const d = document.createElement('div'); d.className = 'rmsg';
      d.textContent = 'Sin resultados. Prueba otro término o habilita más fuentes (Jamendo/Archive/Navidrome).';
      panel.appendChild(d); return;
    }
    for (const r of results) panel.appendChild(row(r));
  }

  function row(r) {
    const el = document.createElement('div'); el.className = 'rrow';
    const canMix = r.availability === 'mezclar';
    const info = document.createElement('div'); info.className = 'rinfo';
    info.innerHTML = `<div class="rt" title="${esc(r.title || r.filename)}">${esc(r.title || r.filename)}</div>` +
      `<div class="rs">${esc(r.artist || '—')} · <b>${esc(r.sourceLabel)}</b> · ${esc(r.availability)}${r.restrictions && r.restrictions.length ? ' · ' + esc(r.restrictions.join('-')) : ''}</div>`;
    el.appendChild(info);
    const acts = document.createElement('div'); acts.className = 'racts';
    const mk = (t, on, fn) => { const b = document.createElement('button'); b.textContent = t; b.disabled = !on; if (on) b.addEventListener('click', fn); return b; };
    acts.appendChild(mk('▶A', canMix, () => load(r, 0)));
    acts.appendChild(mk('▶B', canMix, () => load(r, 1)));
    el.appendChild(acts);
    return el;
  }

  async function load(r, deck) {
    if (r.availability === 'consultar') { status('«' + (r.title || r.filename) + '» es de solo consulta por su licencia.', true); return; }
    if (!(await ensureStarted())) return;
    try {
      status('Cargando «' + (r.title || r.filename) + '» en ' + (deck ? 'B' : 'A') + '…');
      const bytes = await bytesOf(r);
      await bridge.load(deck, bytes, r.filename);   // bridge.onLoaded actualizará el estado al terminar
    } catch (e) {
      status('No se pudo cargar: ' + (e.message || e), true);
    }
  }

  let deb;
  input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(doSearch, 350); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(deb); doSearch(); } });

  return { refreshLocal };
}
