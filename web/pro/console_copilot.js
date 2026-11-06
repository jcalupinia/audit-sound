// AUDIT SOUND · Fase 3A — Copiloto IA sobre la imagen aprobada.
// La IA ANALIZA y RECOMIENDA la SIGUIENTE pista compatible de tu biblioteca local
// (tono Camelot + BPM + energía) y aprende de lo que preparas. Es read-only: NO toca el
// motor hasta que pulsas «Preparar», que carga la sugerencia al plato libre. Reutiliza
// copilot.js (motor de recomendación) y library.js (pool con bpm/key/energy, que
// `analyzeAwait` del motor rellena sin cargar la pista a un plato). No rediseña la imagen:
// dibuja una tarjeta semitransparente sobre la zona «Siguiente en la sesión» del panel.
import { Copilot, camelot } from './copilot.js';
import * as LIB from './library.js';

// left, top, width, height en % sobre la imagen (1672×941), en la columna derecha
// «IA Copiloto», justo bajo el rótulo «Siguiente en la sesión» (donde la imagen dibuja la
// tarjeta de ejemplo con compatibilidad armónica / transición / energía). Medido sobre
// landing_consola.webp; ajustable al píxel sin tocar la lógica.
const CARD = [81.3, 41.0, 18.0, 18.8];

export function setupCopilot({ frame, bridge, ensureStarted, getDeckInfo, chooseFreeDeck, onStatus }) {
  if (!frame) return { refreshPool: async () => {}, remember: async () => {}, suggestNow: () => {}, best: () => null };
  const say = (t, e) => onStatus && onStatus(t, e);
  const copilot = new Copilot();

  // --- Tarjeta de sugerencia (semitransparente, cubre la tarjeta decorativa de la imagen) ---
  const card = document.createElement('div');
  card.id = 'copiCard';
  card.style.cssText =
    `position:absolute;left:${CARD[0]}%;top:${CARD[1]}%;width:${CARD[2]}%;height:${CARD[3]}%;z-index:4;` +
    'background:rgba(6,16,30,.88);border:1px solid rgba(199,168,60,.5);border-radius:10px;' +
    'padding:6px 9px;color:#eaf2ff;font:600 11px/1.3 system-ui,sans-serif;display:flex;flex-direction:column;gap:2px;overflow:hidden;box-sizing:border-box';
  card.innerHTML =
    '<div style="color:#C7A83C;font-size:9px;letter-spacing:.4px">IA COPILOTO · SIGUIENTE</div>' +
    '<div id="copiName" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">—</div>' +
    '<div id="copiMeta" style="font-weight:400;color:#9fe0ff;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">—</div>' +
    '<div id="copiTip" style="font-weight:400;color:#c9d6e8;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>' +
    '<button id="copiPrep" type="button" disabled style="margin-top:auto;align-self:flex-start;background:#0E2C50;color:#eaf2ff;border:1px solid rgba(199,168,60,.6);border-radius:7px;padding:3px 12px;font:600 11px system-ui,sans-serif;cursor:pointer">Preparar ▸</button>';
  frame.appendChild(card);
  const nameEl = card.querySelector('#copiName');
  const metaEl = card.querySelector('#copiMeta');
  const tipEl = card.querySelector('#copiTip');
  const prepBtn = card.querySelector('#copiPrep');

  let current = null, best = null;

  // Carga en el pool los metadatos de la biblioteca local (los que ya tienen bpm/tono).
  async function refreshPool() {
    try {
      if (!LIB.available()) return;
      const rows = await LIB.listTracks();
      for (const r of rows) if (r && r.name) copilot.addTrack({ id: r.id, name: r.name, bpm: r.bpm, key: r.key, energy: r.energy });
    } catch (e) {}
  }

  // Analiza una pista (sin cargarla a un plato) y la recuerda en el pool + biblioteca,
  // para que el copiloto pueda proponerla y que persista entre sesiones.
  async function remember(fileOrBytes, name) {
    let a = null;
    try { a = await bridge.analyzeAwait(fileOrBytes, name); } catch (e) {}
    copilot.addTrack({ id: name, name, bpm: a ? a.bpm : 0, key: a ? a.key : -1, energy: a ? a.energy : 0 });
    try {
      if (LIB.available()) {
        const bytes = (fileOrBytes instanceof ArrayBuffer) ? fileOrBytes.slice(0) : await fileOrBytes.arrayBuffer();
        await LIB.putTrack({ id: name, name, bytes, bpm: a ? a.bpm : 0, key: a ? a.key : -1, energy: a ? a.energy : 0 });
      }
    } catch (e) {}
    suggestNow();
    return a;
  }

  // Elige qué plato representa "lo que suena ahora" (base de la recomendación).
  function pickCurrentDeck() {
    const A = getDeckInfo(0), B = getDeckInfo(1);
    if (A.playing && !B.playing) return 0;
    if (B.playing && !A.playing) return 1;
    if (A.playing && B.playing) return 0;
    if (A.loaded && !B.loaded) return 0;
    if (B.loaded && !A.loaded) return 1;
    return A.loaded ? 0 : (B.loaded ? 1 : -1);
  }

  function suggestNow() {
    const d = pickCurrentDeck();
    if (d < 0) { current = null; best = null; render(); return; }
    const info = getDeckInfo(d);
    const known = copilot.library.find((t) => t.name === info.name);
    current = {
      name: info.name,
      bpm: info.bpm || (known ? known.bpm : 0) || 0,
      key: (info.key != null && info.key >= 0) ? info.key : (known ? known.key : -1),
      energy: known ? known.energy : 0,
    };
    const onDecks = new Set([getDeckInfo(0).name, getDeckInfo(1).name].filter(Boolean));
    const recs = copilot.recommend(current, 8).filter((r) => !onDecks.has(r.track.name));
    best = recs[0] || null;
    render();
  }

  function render() {
    if (!best) {
      nameEl.textContent = '—';
      metaEl.textContent = copilot.size() ? 'reproduce una pista para recibir sugerencias' : 'guarda pistas en tu biblioteca (Importar)';
      tipEl.textContent = '';
      prepBtn.disabled = true;
      return;
    }
    const t = best.track;
    nameEl.textContent = t.name;
    nameEl.title = t.name;
    metaEl.textContent = `${camelot(t.key)} · ${Math.round(t.bpm) || '?'} BPM · ${(best.score * 100) | 0}% · ${best.reason}`;
    tipEl.textContent = '▸ ' + copilot.suggestTransition(current, best);
    prepBtn.disabled = false;
  }

  prepBtn.addEventListener('click', async () => {
    if (!best) return;
    if (!(await ensureStarted())) return;
    const free = chooseFreeDeck();
    const t = best.track;
    try {
      const bytes = await LIB.getBytes(t.id);
      if (!bytes) { say('No encuentro los bytes de «' + t.name + '» en la biblioteca.', true); return; }
      say('Copiloto: preparando «' + t.name + '» en ' + (free ? 'B' : 'A') + '…');
      await bridge.load(free, bytes, t.name);
      copilot.accept(current, best);   // aprende de lo que preparas
      suggestNow();
    } catch (e) { say('No se pudo preparar: ' + (e.message || e), true); }
  });

  // Re-evalúa periódicamente (barato: solo recalcula sobre el pool en memoria).
  setInterval(suggestNow, 1500);
  refreshPool().then(suggestNow);

  return { refreshPool, remember, suggestNow, best: () => (best ? best.track : null), _copilot: copilot };
}
