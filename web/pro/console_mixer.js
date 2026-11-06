// AUDIT SOUND · Fase 2 — Controles de plato sobre la imagen aprobada, cableados al
// motor WASM real (el mismo de mixer.html): EQ HI/MID/LOW, Keylock, SYNC (igualar
// tempo), Loop (beats + IN/OUT/reloop), Hotcues 1-4 y beatjump. No rediseña la imagen:
// crea controles transparentes posicionados en % sobre los controles dibujados.
// Las coordenadas (COORDS) se midieron sobre landing_consola.webp con una rejilla; son
// ajustables al píxel si hiciera falta sin tocar la lógica.

// Coordenadas en % [left, top, width, height] por control. A = plato 0, B = plato 1.
const COORDS = {
  // EQ (rangos verticales sobre las perillas HI/MID/LOW)
  eqHiA: [36.8, 42.5, 3.4, 5.2], eqMidA: [36.8, 48.5, 3.4, 5.2], eqLowA: [36.8, 54.5, 3.4, 5.2],
  eqHiB: [43.6, 42.5, 3.4, 5.2], eqMidB: [43.6, 48.5, 3.4, 5.2], eqLowB: [43.6, 54.5, 3.4, 5.2],
  // Deck A: SYNC, lock, beatjump, loop, hotcues.
  // Corrección de alineación (reporte de la extensión, 2026-11-06): este bloque estaba
  // corrido ~16% a la DERECHA (caía sobre el EQ/crossfader central). El plato B está
  // alineado y las tiras de onda (console_feedback.js) están separadas exactamente 50%
  // (centro A 20.5% / centro B 70.5%), así que cada control del plato A = su equivalente
  // del plato B con el `left` −50% y el MISMO ancho. El EQ-A no se toca (va en la columna
  // central, par-espejo, y ya estaba bien ubicado).
  syncA: [15.3, 53.3, 7.0, 4.2], lockA: [23.0, 53.3, 3.8, 4.2], bjBackA: [27.6, 53.3, 3.8, 4.2], bjFwdA: [32.6, 53.3, 3.8, 4.2],
  loopBeatsA: [15.0, 58.0, 10.0, 3.6], loopInA: [25.5, 58.0, 4.0, 3.6], loopOutA: [30.5, 58.0, 4.0, 3.6], reloopA: [35.5, 58.0, 3.6, 3.6],
  hc1A: [15.3, 62.2, 5.5, 5.0], hc2A: [21.3, 62.2, 5.0, 5.0], hc3A: [27.0, 62.2, 5.0, 5.0], hc4A: [32.5, 62.2, 5.5, 5.0],
  // Deck B
  syncB: [65.3, 53.3, 7.0, 4.2], lockB: [73.0, 53.3, 3.8, 4.2], bjBackB: [77.6, 53.3, 3.8, 4.2], bjFwdB: [82.6, 53.3, 3.8, 4.2],
  loopBeatsB: [65.0, 58.0, 10.0, 3.6], loopInB: [75.5, 58.0, 4.0, 3.6], loopOutB: [80.5, 58.0, 4.0, 3.6], reloopB: [85.5, 58.0, 3.6, 3.6],
  hc1B: [65.3, 62.2, 5.5, 5.0], hc2B: [71.3, 62.2, 5.0, 5.0], hc3B: [77.0, 62.2, 5.0, 5.0], hc4B: [82.5, 62.2, 5.5, 5.0],
  // Pitch fader (vertical) por plato y jog (scrub) sobre el plato
  pitchA: [20.3, 52.0, 1.8, 11.0], pitchB: [63.3, 52.0, 1.8, 11.0],
  jogA: [2.0, 51.0, 18.0, 11.5], jogB: [50.0, 51.0, 16.0, 11.5],
};

const pos = (id) => { const c = COORDS[id]; return `left:${c[0]}%;top:${c[1]}%;width:${c[2]}%;height:${c[3]}%`; };

export function setupMixer({ frame, bridge, ensureStarted, onStatus, getBpm, getPos, getDur }) {
  if (!frame) return;
  const say = (t, e) => onStatus && onStatus(t, e);
  getDur = getDur || (() => 0);

  const addBtn = (id, title) => {
    const b = document.createElement('button');
    b.className = 'hot'; b.id = id; b.type = 'button'; b.setAttribute('aria-label', title); b.title = title;
    b.style.cssText = "position:absolute;background:transparent;border:0;cursor:pointer;border-radius:8px;z-index:2;" + pos(id);
    frame.appendChild(b); return b;
  };
  const addEq = (id, title) => {
    const r = document.createElement('input');
    // Escala del motor en dB: -12 = corte total (gain 0), 0 = plano, +12 = realce.
    r.type = 'range'; r.id = id; r.min = '-12'; r.max = '12'; r.step = '0.5'; r.value = '0';
    r.setAttribute('aria-label', title); r.title = title + ' (doble clic = plano)';
    // rango vertical transparente sobre la perilla; arriba = realzar
    r.style.cssText = 'position:absolute;-webkit-appearance:none;appearance:none;background:transparent;cursor:ns-resize;' +
      'writing-mode:vertical-lr;direction:rtl;z-index:2;' + pos(id);
    frame.appendChild(r); return r;
  };
  // Pitch fader vertical (±%): arriba = más rápido. value en % (-8..+8).
  const addPitch = (id, title) => {
    const r = document.createElement('input');
    r.type = 'range'; r.id = id; r.min = '-8'; r.max = '8'; r.step = '0.1'; r.value = '0';
    r.setAttribute('aria-label', title); r.title = title + ' (doble clic = 0%)';
    r.style.cssText = 'position:absolute;-webkit-appearance:none;appearance:none;background:transparent;cursor:ns-resize;' +
      'writing-mode:vertical-lr;direction:rtl;z-index:2;' + pos(id);
    frame.appendChild(r); return r;
  };
  // Zona de jog (scrub): arrastrar horizontal mueve el cabezal (seek) como un plato.
  const addJog = (id, title) => {
    const b = document.createElement('div');
    b.id = id; b.setAttribute('role', 'slider'); b.setAttribute('aria-label', title); b.title = title;
    // z-index 1: el jog va DEBAJO de los botones discretos (loop/hotcue/sync/pitch) para
    // que un solapamiento no bloquee un clic; el jog solo captura el arrastre en el plato libre.
    b.style.cssText = 'position:absolute;background:transparent;cursor:ew-resize;touch-action:none;z-index:1;border-radius:50%;' + pos(id);
    frame.appendChild(b); return b;
  };

  // --- EQ por plato ---
  [0, 1].forEach((deck) => {
    const P = deck ? 'B' : 'A';
    const st = { low: 0, mid: 0, high: 0 };   // dB; 0 = plano
    const apply = () => bridge.eq(deck, st.low, st.mid, st.high);
    const bands = { high: 'eqHi' + P, mid: 'eqMid' + P, low: 'eqLow' + P };
    for (const band of ['high', 'mid', 'low']) {
      const el = addEq(bands[band], 'EQ ' + band.toUpperCase() + ' ' + P);
      el.addEventListener('input', async () => { if (!(await ensureStarted())) return; st[band] = parseFloat(el.value); apply(); });
      el.addEventListener('dblclick', async () => { if (!(await ensureStarted())) return; el.value = '0'; st[band] = 0; apply(); say('EQ ' + band.toUpperCase() + ' ' + P + ' plano'); });
    }
  });

  // --- Keylock / SYNC / beatjump / loop / hotcues ---
  [0, 1].forEach((deck) => {
    const P = deck ? 'B' : 'A';

    // Keylock (anillo verde mientras está ON)
    let lockOn = false;
    const lockBtn = addBtn('lock' + P, 'Keylock ' + P);
    lockBtn.addEventListener('click', async () => {
      if (!(await ensureStarted())) return; lockOn = !lockOn; bridge.keylock(deck, lockOn);
      lockBtn.classList.toggle('on', lockOn);
      say('Keylock ' + P + ': ' + (lockOn ? 'ON' : 'off'));
    });

    // SYNC: igualar el tempo al otro plato (destello del anillo al aplicar)
    const syncBtn = addBtn('sync' + P, 'SYNC ' + P);
    syncBtn.addEventListener('click', async () => {
      if (!(await ensureStarted())) return;
      const me = getBpm(deck), other = getBpm(deck ? 0 : 1);
      if (me > 0 && other > 0) {
        bridge.rate(deck, other / me); say('SYNC ' + P + ' → ' + Math.round(other) + ' BPM');
        syncBtn.classList.add('on'); setTimeout(() => syncBtn.classList.remove('on'), 1200);
      } else say('SYNC ' + P + ': falta BPM en algún plato.', true);
    });

    // Beatjump
    addBtn('bjBack' + P, 'Saltar atrás ' + P).addEventListener('click', async () => { if (await ensureStarted()) bridge.beatjump(deck, -4); });
    addBtn('bjFwd' + P, 'Saltar adelante ' + P).addEventListener('click', async () => { if (await ensureStarted()) bridge.beatjump(deck, 4); });

    // Loop
    const BARS = [1, 2, 4, 8, 16];
    let bars = deck ? 8 : 4, loopOn = false;
    const beatsBtn = addBtn('loopBeats' + P, 'Compases del loop ' + P);
    const updBeats = () => beatsBtn.setAttribute('aria-label', bars + ' beats ' + P);
    updBeats();
    const inBtn = addBtn('loopIn' + P, 'Activar loop ' + P);
    const setLoopVisual = () => inBtn.classList.toggle('on', loopOn);
    beatsBtn.addEventListener('click', () => { bars = BARS[(BARS.indexOf(bars) + 1) % BARS.length]; updBeats(); say('Loop ' + P + ': ' + bars + ' beats'); if (loopOn) bridge.loop(deck, true, bars); });
    inBtn.addEventListener('click', async () => { if (!(await ensureStarted())) return; loopOn = true; bridge.loop(deck, true, bars); setLoopVisual(); say('Loop ' + P + ' ON (' + bars + ' beats)'); });
    addBtn('loopOut' + P, 'Salir del loop ' + P).addEventListener('click', async () => { if (!(await ensureStarted())) return; loopOn = false; bridge.loop(deck, false, bars); setLoopVisual(); say('Loop ' + P + ' off'); });
    addBtn('reloop' + P, 'Reloop ' + P).addEventListener('click', async () => { if (!(await ensureStarted())) return; loopOn = !loopOn; bridge.loop(deck, loopOn, bars); setLoopVisual(); say('Loop ' + P + ' ' + (loopOn ? 'ON' : 'off')); });

    // Hotcues 1-4 (anillo verde = fijado)
    const hcSet = {};
    for (let i = 0; i < 4; i++) {
      const el = addBtn('hc' + (i + 1) + P, 'Hotcue ' + (i + 1) + ' ' + P);
      el.addEventListener('click', async () => {
        if (!(await ensureStarted())) return;
        if (hcSet[i]) { bridge.hotcueJump(deck, i); say('Hotcue ' + (i + 1) + ' ' + P + ' → salto'); }
        else { bridge.hotcueSet(deck, i, getPos(deck)); hcSet[i] = true; el.classList.add('on'); el.setAttribute('aria-pressed', 'true'); say('Hotcue ' + (i + 1) + ' ' + P + ' fijado'); }
      });
      el.addEventListener('dblclick', async () => { if (!(await ensureStarted())) return; bridge.hotcueClear(deck, i); hcSet[i] = false; el.classList.remove('on'); el.setAttribute('aria-pressed', 'false'); say('Hotcue ' + (i + 1) + ' ' + P + ' borrado'); });
    }
  });

  // Pitch fader + Jog (scrub) por plato
  [0, 1].forEach((deck) => {
    const P = deck ? 'B' : 'A';

    // Pitch ±8%: rate = 1 + v/100
    const pf = addPitch('pitch' + P, 'Pitch ' + P);
    pf.addEventListener('input', async () => { if (!(await ensureStarted())) return; bridge.rate(deck, 1 + parseFloat(pf.value) / 100); });
    pf.addEventListener('dblclick', async () => { if (!(await ensureStarted())) return; pf.value = '0'; bridge.rate(deck, 1); say('Pitch ' + P + ' = 0%'); });

    // Jog: arrastrar horizontal mueve el cabezal (seek). Un ancho completo ≈ SCRUB_S segundos.
    const SCRUB_S = 8;
    const jog = addJog('jog' + P, 'Jog (scrub) ' + P);
    let dragging = false, startX = 0, startPos = 0, w = 1;
    jog.addEventListener('pointerdown', async (e) => {
      if (!(await ensureStarted())) return;
      dragging = true; startX = e.clientX; startPos = getPos(deck); w = jog.getBoundingClientRect().width || 1;
      try { jog.setPointerCapture(e.pointerId); } catch (_) {}
    });
    jog.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - startX) / w;            // -1..1 aprox
      const dur = getDur(deck) || 0;
      let t = startPos + dx * SCRUB_S;                 // derecha = adelante
      if (dur > 0) t = Math.max(0, Math.min(dur - 0.05, t));
      bridge.seek(deck, t);
    });
    const endDrag = () => { dragging = false; };
    jog.addEventListener('pointerup', endDrag);
    jog.addEventListener('pointercancel', endDrag);
    jog.addEventListener('pointerleave', endDrag);
  });
}
