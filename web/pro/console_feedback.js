// AUDIT SOUND · Fase 2b — Capa de FEEDBACK visual sobre la imagen aprobada.
// Un DJ profesional necesita VER: la forma de onda real moviéndose, el cabezal, el
// tiempo (transcurrido/total), el BPM y el nivel (VU). No rediseña la imagen: dibuja
// en canvas transparentes colocados exactamente sobre las zonas de onda, y un VU sobre
// la barra de máster. Los datos vienen del motor real (onStatus/onWaveform/CTRL.PEAK).
//
// Posee la lectura de CTRL.PEAK (la lee y resetea en cada frame para el VU en vivo) y
// expone vu() como nivel suavizado, para que nadie más compita por ese contador.

const COORDS = {
  waveA: [2.0, 47.2, 37.0, 5.6],     // tira de onda del plato A (verde)
  waveB: [52.0, 47.2, 37.0, 5.6],    // tira de onda del plato B (azul)
  vuMaster: [61.5, 90.2, 21.0, 2.0], // barra de nivel sobre "Master"
};

const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

export function setupFeedback({ frame, bridge, state }) {
  if (!frame) return { vu: () => 0 };
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const mkCanvas = (id, c) => {
    const cv = document.createElement('canvas'); cv.id = id;
    cv.style.cssText = `position:absolute;left:${c[0]}%;top:${c[1]}%;width:${c[2]}%;height:${c[3]}%;border-radius:6px;z-index:3;pointer-events:none`;
    frame.appendChild(cv); return cv;
  };
  const waveCv = [mkCanvas('fbWaveA', COORDS.waveA), mkCanvas('fbWaveB', COORDS.waveB)];

  // VU de máster (barra)
  const vuWrap = document.createElement('div'); vuWrap.id = 'fbVu';
  vuWrap.style.cssText = `position:absolute;left:${COORDS.vuMaster[0]}%;top:${COORDS.vuMaster[1]}%;width:${COORDS.vuMaster[2]}%;height:${COORDS.vuMaster[3]}%;z-index:3;pointer-events:none;overflow:hidden;border-radius:3px`;
  const vuFill = document.createElement('div');
  vuFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#36e26a 60%,#f2c744 85%,#ff6b6b);opacity:.9;transition:width .05s linear';
  vuWrap.appendChild(vuFill); frame.appendChild(vuWrap);

  function drawWave(d) {
    const cv = waveCv[d]; const ctx = cv.getContext('2d');
    const w = cv.width = Math.max(1, Math.round(cv.clientWidth * dpr));
    const h = cv.height = Math.max(1, Math.round(cv.clientHeight * dpr));
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(6,16,30,.82)'; ctx.fillRect(0, 0, w, h);  // cubre la onda decorativa
    const wv = state.waves[d]; const mid = h / 2; const col = d ? '#ff7ac2' : '#2ec5ff';
    // Beatgrid: una línea por beat (marcada cada 4 = inicio de compás). Salta líneas muy
    // juntas para que no se vea una pared sólida en pistas largas.
    const bpm = state.bpm[d], dur = state.dur[d];
    if (bpm > 0 && dur > 0) {
      const beat = 60 / bpm, off = (((state.beatOffset[d] || 0) % beat) + beat) % beat;
      let lastX = -5;
      for (let t = off, k = 0; t < dur; t += beat, k++) {
        const x = (t / dur) * w, down = (k % 4 === 0);
        if (!down && x - lastX < 2 * dpr) continue;
        lastX = x;
        ctx.strokeStyle = down ? 'rgba(199,168,60,.5)' : 'rgba(255,255,255,.09)';
        ctx.lineWidth = down ? 1.3 : 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
    }
    if (wv && wv.bins) {
      ctx.strokeStyle = col; ctx.globalAlpha = .95; ctx.lineWidth = 1; ctx.beginPath();
      const n = wv.bins;
      for (let i = 0; i < n; i++) { const x = i / n * w; ctx.moveTo(x, mid - wv.max[i] * mid * 0.95); ctx.lineTo(x, mid - wv.min[i] * mid * 0.95); }
      ctx.stroke(); ctx.globalAlpha = 1;
      const dur = state.dur[d] || 0;
      if (dur > 0) { const x = (state.pos[d] / dur) * w; ctx.strokeStyle = '#C7A83C'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    }
    // tiempo (izq) + BPM (der)
    ctx.fillStyle = '#eaf2ff'; ctx.font = (11 * dpr) + 'px system-ui,sans-serif'; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText(fmt(state.pos[d]) + ' / ' + fmt(state.dur[d]), 6 * dpr, 4 * dpr);
    if (state.bpm[d] > 0) { ctx.textAlign = 'right'; ctx.fillStyle = '#9fe0ff'; ctx.fillText(Math.round(state.bpm[d]) + ' BPM', w - 6 * dpr, 4 * dpr); ctx.textAlign = 'left'; }
  }

  let vuLevel = 0;
  const ctrl = (() => { try { return new Int32Array(bridge._buffers.ctrl); } catch (e) { return null; } })();
  function tick() {
    drawWave(0); drawWave(1);
    let peak = 0; if (ctrl) { try { peak = (Atomics.load(ctrl, 3) || 0) / 1e6; Atomics.store(ctrl, 3, 0); } catch (e) {} }
    vuLevel = Math.max(peak, vuLevel * 0.86);
    vuFill.style.width = Math.min(100, vuLevel * 140).toFixed(0) + '%';
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return { vu: () => vuLevel };
}
