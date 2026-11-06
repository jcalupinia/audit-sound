// AUDIT SOUND · Fase 3C — «Pídele un set a la IA»: recuadro conversacional.
// Un clic en «Generador IA» (barra superior) abre una ventana centrada donde describes el
// set en texto («cumbia 30 min que suba de energía», «lofi para estudiar, 10 pistas»). La
// IA EXTRAE género/artista, duración/nº de pistas y la dirección de energía, busca en las
// fuentes, ORDENA las pistas (arco de energía / BPM cuando hay datos) y las manda al
// AutoMix (reutiliza console_autodj.loadSet). Honesto: la «IA» es un intérprete + ordenador
// determinista (no un LLM externo); las transiciones las afina el Selector del motor.

// Overlay transparente sobre la pestaña «Generador IA» de la barra superior (dibujada en la
// imagen, antes sin función). Medido sobre landing_consola.webp (1672×941); ajustable.
const LAUNCH = [58.5, 0.8, 9.6, 5.8];

const STOP = new Set(('set sets lista listas playlist mezcla mezclar dj música musica pon ponme hazme haz quiero dame arma armame un una unos unas de del la el los las que con para por y o a me un rato temas tema pistas pista canciones cancion canción minutos minuto min mins m hora horas h').split(/\s+/));

// Extrae de la petición: query (género/artista), nº de pistas y dirección de energía.
export function parseRequest(text) {
  const t = ' ' + String(text || '').toLowerCase().trim() + ' ';
  let count = 0, minutes = 0;
  let m = t.match(/(\d+)\s*(pistas?|canciones?|temas?)/);
  if (m) count = parseInt(m[1], 10);
  m = t.match(/(\d+)\s*(h|horas?)\b/);
  if (m) minutes += parseInt(m[1], 10) * 60;
  m = t.match(/(\d+)\s*(min(?:utos?)?|m)\b/);
  if (m) minutes += parseInt(m[1], 10);
  if (!count && minutes) count = Math.round(minutes / 3.5);   // ~3,5 min por pista
  if (!count) count = 10;
  count = Math.min(30, Math.max(2, count));
  let energy = 'flat';
  if (/\bsub[ae]\w*|ascend\w*|subida|crescendo|de menos a m[aá]s|arriba\b/.test(t)) energy = 'up';
  else if (/\bbaj[ae]\w*|descend\w*|bajada|relaj\w*|chill\b|tranqui\w*|de m[aá]s a menos|abajo\b/.test(t)) energy = 'down';
  // query = texto sin números/unidades ni palabras de control
  const query = t
    .replace(/\d+\s*(pistas?|canciones?|temas?|min(?:utos?)?|h|horas?|m)\b/g, ' ')
    .replace(/\bsub[ae]\w*|ascend\w*|crescendo|baj[ae]\w*|descend\w*|relaj\w*|energ[ií]a\w*|chill|tranqui\w*\b/g, ' ')
    .replace(/[.,;:!¿?¡"'()]/g, ' ')
    .split(/\s+/).filter((w) => w && !STOP.has(w)).join(' ').trim();
  return { query, count, energy, minutes };
}

// Ordena las pistas según el arco de energía pedido (cuando hay energía/BPM conocidos).
export function orderTracks(tracks, energy) {
  const arr = tracks.slice();
  const e = (r) => (typeof r.energy === 'number' ? r.energy : NaN);
  const anyEnergy = arr.some((r) => !Number.isNaN(e(r)));
  if (energy === 'up' && anyEnergy) arr.sort((a, b) => (e(a) || 0) - (e(b) || 0));
  else if (energy === 'down' && anyEnergy) arr.sort((a, b) => (e(b) || 0) - (e(a) || 0));
  else if (arr.some((r) => r.bpm)) arr.sort((a, b) => (a.bpm || 0) - (b.bpm || 0));   // suaviza transiciones
  return arr;
}

export function setupSetAI({ frame, search, autodj, onStatus, ensureStarted }) {
  if (!frame || !search || !autodj) return { open: () => {}, create: async () => 0 };
  const say = (t, e) => onStatus && onStatus(t, e);

  // --- Lanzador sobre «Generador IA» ---
  const launch = document.createElement('button');
  launch.id = 'setaiLaunch'; launch.type = 'button';
  launch.title = 'Generador IA: pídele un set a la IA en texto';
  launch.style.cssText = `position:absolute;left:${LAUNCH[0]}%;top:${LAUNCH[1]}%;width:${LAUNCH[2]}%;height:${LAUNCH[3]}%;background:transparent;border:0;cursor:pointer;z-index:5`;
  frame.appendChild(launch);

  // --- Modal ---
  const back = document.createElement('div');
  back.id = 'setaiModal';
  back.style.cssText = 'position:absolute;inset:0;z-index:20;display:none;align-items:center;justify-content:center;background:rgba(3,10,20,.66);backdrop-filter:blur(2px)';
  const box = document.createElement('div');
  box.style.cssText = 'width:min(90%,440px);background:#0A2342;border:1px solid rgba(199,168,60,.55);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.5);padding:18px 18px 16px;color:#eaf2ff;font:400 13px/1.45 system-ui,sans-serif';
  box.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
      '<span style="color:#C7A83C;font-size:18px">✨</span>' +
      '<b style="font-size:15px">Pídele un set a la IA</b>' +
      '<button id="setaiClose" type="button" title="cerrar" style="margin-left:auto;background:transparent;border:0;color:#9fb3c8;font-size:20px;cursor:pointer;line-height:1">×</button>' +
    '</div>' +
    '<div style="color:#9fb3c8;font-size:11px;margin-bottom:10px">Describe el set: género o artista, cuánto dura y el ánimo. La IA lo arma y lo mezcla sola con las fuentes disponibles + tu biblioteca.</div>' +
    '<textarea id="setaiText" rows="3" placeholder="p. ej. «lofi 30 min que suba de energía» · «cumbia, 12 pistas» · «chill para estudiar»" ' +
      'style="width:100%;box-sizing:border-box;background:#071B2F;color:#eaf2ff;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:9px 10px;font:400 13px system-ui,sans-serif;resize:vertical"></textarea>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px">' +
      '<button class="setaiEx" type="button" data-q="lofi 30 min que suba de energía" style="background:#0E2C50;color:#c9d6e8;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:3px 10px;font-size:11px;cursor:pointer">lofi 30 min ↑</button>' +
      '<button class="setaiEx" type="button" data-q="creative commons chill, 10 pistas" style="background:#0E2C50;color:#c9d6e8;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:3px 10px;font-size:11px;cursor:pointer">chill 10 pistas</button>' +
      '<button class="setaiEx" type="button" data-q="electronica 45 min" style="background:#0E2C50;color:#c9d6e8;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:3px 10px;font-size:11px;cursor:pointer">electrónica 45 min</button>' +
    '</div>' +
    '<div id="setaiMsg" style="min-height:16px;font-size:11px;color:#9fe0ff;margin-bottom:10px"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button id="setaiCancel" type="button" style="background:transparent;color:#9fb3c8;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:7px 14px;font:600 12px system-ui;cursor:pointer">Cancelar</button>' +
      '<button id="setaiGo" type="button" style="background:#C7A83C;color:#071B2F;border:0;border-radius:9px;padding:7px 16px;font:700 12px system-ui;cursor:pointer">Crear set ▸</button>' +
    '</div>';
  back.appendChild(box); frame.appendChild(back);

  const txt = box.querySelector('#setaiText');
  const msg = box.querySelector('#setaiMsg');
  const goBtn = box.querySelector('#setaiGo');
  const setMsg = (t, err) => { msg.textContent = t; msg.style.color = err ? '#ff9a9a' : '#9fe0ff'; };

  const open = () => { back.style.display = 'flex'; setMsg(''); setTimeout(() => txt.focus(), 30); };
  const close = () => { back.style.display = 'none'; };
  launch.addEventListener('click', open);
  box.querySelector('#setaiClose').addEventListener('click', close);
  box.querySelector('#setaiCancel').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  box.querySelectorAll('.setaiEx').forEach((b) => b.addEventListener('click', () => { txt.value = b.dataset.q; txt.focus(); }));

  // Núcleo: interpreta la petición, busca, ordena y manda el set al AutoMix.
  async function create(text) {
    const req = parseRequest(text);
    if (!(await ensureStarted())) return 0;
    setMsg('Interpreté: ' + (req.query ? '«' + req.query + '»' : 'tu biblioteca') + ' · ' + req.count + ' pistas · energía ' +
      (req.energy === 'up' ? 'ascendente' : req.energy === 'down' ? 'descendente' : 'pareja') + '. Buscando…');
    let out;
    try { out = await search.searchAll(req.query, { perSource: Math.max(req.count * 2, 12) }); }
    catch (e) { setMsg('No se pudo buscar: ' + (e.message || e), true); return 0; }
    const mixable = (out.results || []).filter((r) => r.availability === 'mezclar');
    if (!mixable.length) {
      setMsg('No encontré pistas aptas para mezclar para «' + req.query + '». Prueba otro género, «creative commons», o importa pistas tuyas.', true);
      return 0;
    }
    const ordered = orderTracks(mixable, req.energy).slice(0, req.count);
    setMsg('Armando y mezclando ' + ordered.length + ' pistas…');
    const added = await autodj.loadSet(ordered);
    if (added > 0) { setMsg('Set en marcha: ' + added + ' pistas mezclándose solas. ✨'); setTimeout(close, 1400); }
    return added;
  }
  goBtn.addEventListener('click', async () => { goBtn.disabled = true; try { await create(txt.value); } finally { goBtn.disabled = false; } });

  return { open, close, create, parseRequest, orderTracks };
}
