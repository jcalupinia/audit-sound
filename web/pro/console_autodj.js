// AUDIT SOUND · Fase 3B — «Armar set y mezclar»: DJ Automático sobre la imagen aprobada.
// Escribes un artista o género en el buscador, pulsas «DJ Automático (IA 24/7)» y la IA
// busca en las fuentes, se queda con las pistas APTAS PARA MEZCLAR, las carga en el
// AutoMix del motor (dj_auto_add_track) y empieza a enlazarlas solo (crossfade por
// posición, verificado: el audio sube durante la transición). Reutiliza el AutoMix real
// del motor WASM y el buscador (console_search). No rediseña la imagen: pone controles
// transparentes sobre los botones de «Modo de operación» ya dibujados.

// Overlays transparentes sobre los 3 botones de «Modo de operación (en vivo)».
// Medido sobre landing_consola.webp (1672×941); ajustable al píxel sin tocar la lógica.
const MODES = {
  manual: [1.5, 30.4, 12.6, 5.4],
  hibrido: [14.6, 30.4, 14.8, 5.4],
  auto: [29.9, 30.4, 13.0, 5.4],
};

export function setupAutoDJ({ frame, bridge, ensureStarted, search, onStatus, getCount }) {
  if (!frame || !search) return { buildSet: async () => {}, isAuto: () => false, stop: () => {} };
  const say = (t, e) => onStatus && onStatus(t, e);

  const mkBtn = (id, c, title) => {
    const b = document.createElement('button');
    b.id = id; b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.style.cssText = `position:absolute;left:${c[0]}%;top:${c[1]}%;width:${c[2]}%;height:${c[3]}%;` +
      'background:transparent;border:0;border-radius:12px;cursor:pointer;z-index:4';
    frame.appendChild(b); return b;
  };
  const btnManual = mkBtn('modeManual', MODES.manual, 'DJ Manual');
  const btnHibrido = mkBtn('modeHibrido', MODES.hibrido, 'DJ Híbrido (asistido)');
  const btnAuto = mkBtn('modeAuto', MODES.auto, 'DJ Automático (IA 24/7): arma un set y mezcla solo');

  let autoOn = false, building = false;
  const ringAuto = () => btnAuto.classList.toggle('on', autoOn);

  function stop() {
    if (!autoOn) return;
    autoOn = false; ringAuto();
    try { bridge.autoEnable(false); } catch (e) {}
    say('DJ Automático detenido.');
  }

  // Carga una lista YA ORDENADA de resultados en el AutoMix y arranca la auto-mezcla.
  // La usa buildSet (búsqueda simple) y el Generador de sets por IA (Fase 3C, orden propio).
  async function loadSet(results, transition) {
    if (building) return 0;
    building = true;
    try {
      if (!(await ensureStarted())) return 0;
      const list = (results || []).filter((r) => r && r.availability === 'mezclar');
      if (!list.length) { say('No hay pistas aptas para mezclar en ese resultado.', true); return 0; }
      let added = 0;
      for (const r of list) {
        say('DJ Automático: añadiendo ' + (added + 1) + '/' + list.length + ' · ' + (r.title || r.filename) + '…');
        try { const bytes = await search.bytesOf(r); await bridge.autoAdd(bytes, r.filename); added++; }
        catch (e) { /* salta la que no baje */ }
      }
      if (!added) { say('No se pudo cargar ninguna pista del set.', true); return 0; }
      bridge.autoTransition(transition || 8);
      bridge.autoEnable(true);
      autoOn = true; ringAuto();
      say('DJ Automático en marcha: ' + added + ' pista(s) mezclándose solas. Pulsa «DJ Automático» otra vez para parar.');
      return added;
    } finally { building = false; }
  }

  // Arma un set con una búsqueda simple (artista/género) y arranca la auto-mezcla.
  async function buildSet(query, n) {
    if (building) return 0;
    const count = Math.min(30, Math.max(2, n || (getCount ? getCount() : 10)));
    say('DJ Automático: armando set' + (query ? ' de «' + query + '»' : '') + '…');
    let out;
    try { out = await search.searchAll(query, { perSource: count }); }
    catch (e) { say('No se pudo buscar para el set: ' + (e.message || e), true); return 0; }
    const mixable = (out.results || []).filter((r) => r.availability === 'mezclar').slice(0, count);
    if (!mixable.length) {
      say('No hay pistas aptas para mezclar' + (query ? ' para «' + query + '»' : '') +
        '. Prueba otro término (p. ej. «lofi», «creative commons») o importa pistas tuyas.', true);
      return 0;
    }
    return loadSet(mixable);
  }

  btnAuto.addEventListener('click', async () => {
    if (autoOn) { stop(); return; }
    const q = search.query ? search.query() : '';
    await buildSet(q);
  });
  // Manual / Híbrido: apagan el DJ automático (el control vuelve al DJ / al copiloto).
  btnManual.addEventListener('click', () => { stop(); btnManual.classList.add('on'); btnHibrido.classList.remove('on'); say('Modo Manual.'); });
  btnHibrido.addEventListener('click', () => { stop(); btnHibrido.classList.add('on'); btnManual.classList.remove('on'); say('Modo Híbrido (copiloto asistiendo).'); });

  return { buildSet, loadSet, isAuto: () => autoOn, stop };
}
