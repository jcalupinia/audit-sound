// AUDIT SOUND · Biblioteca REAL sobre la imagen. La tira «Biblioteca multimedia» de la
// imagen es decorativa; este panel la cubre con TU música importada (IndexedDB, library.js)
// y deja cargar cada pista al plato con ▶A/▶B. Se refresca al importar. No rediseña la
// imagen: es un overlay sobre la zona de miniaturas (deja libre el botón «Importar»).
import * as LIB from './library.js';

// left, top, width, height en % sobre la imagen (cubre la tira de miniaturas; el botón
// «Importar Archivos» está a su derecha en 70.5%). Ajustable al píxel.
const PANEL = [18.3, 71.9, 51.6, 13.9];

// Zonas de soltado (arrastrar a mezclar) en % del frame: plato A (izquierda) y B (derecha).
const DECK_ZONES = [[0, 46, 44, 28], [49, 46, 44, 28]];

export function setupLibPanel({ frame, bridge, ensureStarted, chooseFreeDeck, onStatus }) {
  if (!frame) return { refresh: async () => {}, count: () => 0 };
  const say = (t, e) => onStatus && onStatus(t, e);
  let n = 0;

  // --- Arrastrar y soltar (pointer events: sirve para mouse Y para el dedo en móvil) ---
  let hl = null;
  function highlight(d) {
    if (d < 0) { if (hl) hl.style.display = 'none'; return; }
    if (!hl) {
      hl = document.createElement('div');
      hl.style.cssText = 'position:absolute;z-index:7;pointer-events:none;border:2px dashed #C7A83C;border-radius:12px;background:rgba(199,168,60,.14)';
      frame.appendChild(hl);
    }
    const z = DECK_ZONES[d];
    hl.style.left = z[0] + '%'; hl.style.top = z[1] + '%'; hl.style.width = z[2] + '%'; hl.style.height = z[3] + '%';
    hl.style.display = 'block';
  }
  function deckAt(cx, cy) {
    const r = frame.getBoundingClientRect();
    const x = (cx - r.left) / r.width * 100, y = (cy - r.top) / r.height * 100;
    for (let d = 0; d < 2; d++) { const z = DECK_ZONES[d]; if (x >= z[0] && x <= z[0] + z[2] && y >= z[1] && y <= z[1] + z[3]) return d; }
    return -1;
  }
  function makeDraggable(row, t) {
    row.style.touchAction = 'none'; row.style.cursor = 'grab';
    let start = null, ghost = null, moved = false;
    row.addEventListener('pointerdown', (e) => {
      if (e.target && e.target.tagName === 'BUTTON') return;   // los botones ▶A/▶B tienen su click
      start = { x: e.clientX, y: e.clientY }; moved = false;
      try { row.setPointerCapture(e.pointerId); } catch (_) {}
    });
    row.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
      moved = true;
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.textContent = '⇢ ' + t.name;
        ghost.style.cssText = 'position:fixed;z-index:50;pointer-events:none;background:#C7A83C;color:#071B2F;' +
          'font:700 12px system-ui,sans-serif;padding:4px 10px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.5);' +
          'max-width:60vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
        document.body.appendChild(ghost);
      }
      ghost.style.left = (e.clientX + 12) + 'px'; ghost.style.top = (e.clientY + 12) + 'px';
      highlight(deckAt(e.clientX, e.clientY));
    });
    const end = (e) => {
      if (!start) return;
      const wasMoved = moved, d = wasMoved ? deckAt(e.clientX, e.clientY) : -1;
      start = null; moved = false;
      if (ghost) { ghost.remove(); ghost = null; }
      highlight(-1);
      try { row.releasePointerCapture(e.pointerId); } catch (_) {}
      if (wasMoved && d >= 0) { say('Soltado «' + t.name + '» en ' + (d ? 'B' : 'A') + '.'); load(t, d); }
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
  }

  const wrap = document.createElement('div');
  wrap.id = 'libPanel';
  wrap.style.cssText =
    `position:absolute;left:${PANEL[0]}%;top:${PANEL[1]}%;width:${PANEL[2]}%;height:${PANEL[3]}%;z-index:5;` +
    'background:rgba(6,16,30,.92);border:1px solid rgba(199,168,60,.35);border-radius:8px;overflow-y:auto;' +
    'overflow-x:hidden;padding:4px 6px;display:flex;flex-direction:column;gap:3px;-webkit-overflow-scrolling:touch';
  frame.appendChild(wrap);

  async function load(t, deck) {
    if (!(await ensureStarted())) return;
    try {
      const bytes = await LIB.getBytes(t.id);
      if (!bytes) { say('No encuentro «' + t.name + '» en la biblioteca.', true); return; }
      say('Cargando «' + t.name + '» en ' + (deck ? 'B' : 'A') + '…');
      await bridge.load(deck, bytes, t.name);
    } catch (e) { say('No se pudo cargar: ' + (e.message || e), true); }
  }

  const mk = (lbl, t, deck) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = lbl;
    b.style.cssText = 'flex:0 0 auto;background:#0E2C50;color:#eaf2ff;border:1px solid rgba(199,168,60,.5);' +
      'border-radius:6px;padding:2px 9px;font:700 11px system-ui,sans-serif;cursor:pointer;-webkit-appearance:none';
    b.addEventListener('click', () => load(t, deck));
    return b;
  };

  async function refresh() {
    let rows = [];
    try { if (LIB.available()) rows = (await LIB.listTracks()) || []; } catch (e) {}
    n = rows.length;
    wrap.innerHTML = '';
    if (!rows.length) {
      const d = document.createElement('div');
      d.style.cssText = 'color:#9fb3c8;font:400 11px/1.4 system-ui,sans-serif;padding:6px';
      d.textContent = 'Tu música importada aparece aquí. Toca «Importar Archivos» y elige desde tu laptop, un disco externo, o archivos de OneDrive/SharePoint sincronizados.';
      wrap.appendChild(d);
      return;
    }
    const h = document.createElement('div');
    h.style.cssText = 'color:#C7A83C;font:700 10px system-ui,sans-serif;padding:1px 2px;flex:0 0 auto';
    h.textContent = rows.length + ' pista(s) · ▶A/▶B o arrástralas a un plato';
    wrap.appendChild(h);
    for (const t of rows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;flex:0 0 auto;background:rgba(14,44,80,.5);border-radius:6px;padding:3px 6px';
      const nm = document.createElement('div');
      nm.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#eaf2ff;font:600 11px system-ui,sans-serif';
      nm.textContent = t.name; nm.title = t.name;
      row.appendChild(nm);
      if (t.bpm) {
        const meta = document.createElement('span');
        meta.style.cssText = 'flex:0 0 auto;color:#9fe0ff;font:400 10px system-ui,sans-serif';
        meta.textContent = Math.round(t.bpm) + ' BPM';
        row.appendChild(meta);
      }
      row.appendChild(mk('▶A', t, 0));
      row.appendChild(mk('▶B', t, 1));
      makeDraggable(row, t);   // arrastra la fila a un plato para mezclar
      wrap.appendChild(row);
    }
  }

  refresh();
  return { refresh, count: () => n };
}
