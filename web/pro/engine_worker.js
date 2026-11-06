// Worker del motor AUDIT SOUND (WebAssembly). Corre fuera del hilo principal, por
// lo que PUEDE bloquear (Atomics.wait) al crear el hilo del chunk_cache y al esperar
// espacio en el ring buffer. Produce PCM con dj_render y lo escribe al SAB.
//
// Mensajes que recibe (postMessage): {type, ...}
//   init {audio, ctrl, sampleRate}   buffers compartidos + tasa del AudioContext
//   load {deck, bytes, name}         carga PCM en un plato (bytes = ArrayBuffer del archivo)
//   play {deck, on} | seek {deck, s} | cue {deck} | jumpcue {deck}
//   gain|eq|filter|fader|rate|keylock|master|xfader   controles de mezcla
//   hotcue_set|hotcue_jump|hotcue_clear {deck, index} | loop {deck, on, bars} | beatjump {deck, beats}
//   stop
// Mensajes que envía: {type:'ready'} | {type:'loaded', deck, ok, dur, bpm, key, err}
//   {type:'status', decks:[...]}  (posición/estado, periódico)
import { CTRL, CHANNELS, RING_FRAMES } from './ring.js';
import AuditEngine from './audit_engine.js';

let M = null, eng = 0;
let audioF32 = null, ctrl = null;
let running = false;
let nextFileId = 1;

const CHUNK = 512;                  // cuadros por llamada a dj_render (grano fino)
// Backlog objetivo del ring: el productor NO llena todo el anillo (eso daba ~0.7 s
// de latencia de control, defecto W1 de F0), sino que mantiene solo ~43 ms por
// delante. Así un cambio de EQ/crossfader se oye casi de inmediato, con colchón de
// sobra frente al jitter de setTimeout (que refresca cada 3 ms). Ajustable.
const TARGET_BACKLOG = 2048;        // cuadros (~43 ms @48k, ~46 ms @44.1k)
let renderPtr = 0;                  // buffer en el heap WASM para dj_render
let autoCtl = 0;                    // controlador del modo automatico (AutoMix+Selector, P1)
let autoTimer = null;               // intervalo que llama a dj_auto_tick (sin hilo)

function freeFrames() {
  const w = Atomics.load(ctrl, CTRL.WRITE);
  const r = Atomics.load(ctrl, CTRL.READ);
  return RING_FRAMES - (w - r);
}

// Escribe `frames` cuadros interleaved desde el heap WASM (renderPtr) al ring.
function pushToRing(frames) {
  const w = Atomics.load(ctrl, CTRL.WRITE);
  const base = (w % RING_FRAMES);
  const heap = new Float32Array(M.HEAPF32.buffer, renderPtr, frames * CHANNELS);
  // Primera parte (hasta el final del anillo) y envolvente.
  const firstFrames = Math.min(frames, RING_FRAMES - base);
  audioF32.set(heap.subarray(0, firstFrames * CHANNELS), base * CHANNELS);
  if (firstFrames < frames) {
    audioF32.set(heap.subarray(firstFrames * CHANNELS, frames * CHANNELS), 0);
  }
  Atomics.store(ctrl, CTRL.WRITE, w + frames);
}

function pump() {
  // Productor: rellena todo el hueco disponible y CEDE al event loop del Worker,
  // para no bloquear la cola de mensajes (load/play/eq…). El ring (~0.68 s) es un
  // colchón enorme frente al periodo de rellamada (~5 ms), así que no hay underrun
  // tras el arranque. NO se usa Atomics.wait aquí: bloquearía los comandos.
  if (!running || Atomics.load(ctrl, CTRL.RUN) !== 1) return;
  // Rellena solo hasta TARGET_BACKLOG cuadros por delante del cabezal de lectura
  // (latencia baja), sin pasar nunca de la capacidad del anillo.
  while (running && freeFrames() >= CHUNK) {
    const backlog = Atomics.load(ctrl, CTRL.WRITE) - Atomics.load(ctrl, CTRL.READ);
    if (backlog >= TARGET_BACKLOG) break;
    M.ccall('dj_render', 'number', ['number', 'number', 'number', 'number'],
            [eng, renderPtr, CHUNK, CHANNELS]);
    pushToRing(CHUNK);
  }
  setTimeout(pump, 3);
}

function statusTick() {
  if (!M || !eng) return;
  const decks = [0, 1].map((d) => ({
    deck: d,
    loaded: M.ccall('dj_loaded', 'number', ['number', 'number'], [eng, d]),
    playing: M.ccall('dj_playing', 'number', ['number', 'number'], [eng, d]),
    pos: M.ccall('dj_position', 'number', ['number', 'number'], [eng, d]),
    dur: M.ccall('dj_duration', 'number', ['number', 'number'], [eng, d]),
    bpm: M.ccall('dj_get_bpm', 'number', ['number', 'number'], [eng, d]),
    beatOffset: M.ccall('dj_get_beat_offset', 'number', ['number', 'number'], [eng, d]),
  }));
  const autoState = autoCtl ? M.ccall('dj_auto_state', 'number', ['number'], [autoCtl]) : 0;
  postMessage({ type: 'status', decks, under: Atomics.load(ctrl, CTRL.UNDER), autoState });
}

const call = (fn, sig, args) => M.ccall(fn, 'void', sig, args);

// Copia la forma de onda de un deck (bins min/max) para dibujarla en la UI.
function getWaveform(deck) {
  const bins = M.ccall('dj_waveform_bins', 'number', [], []);
  if (bins <= 0) return null;
  const pMin = M._malloc(bins * 4), pMax = M._malloc(bins * 4);
  const n = M.ccall('dj_waveform_copy', 'number', ['number', 'number', 'number', 'number', 'number'],
                    [eng, deck, pMin, pMax, bins]);
  const min = Float32Array.from(M.HEAPF32.subarray(pMin >> 2, (pMin >> 2) + bins));
  const max = Float32Array.from(M.HEAPF32.subarray(pMax >> 2, (pMax >> 2) + bins));
  M._free(pMin); M._free(pMax);
  return n > 0 ? { bins, min, max } : null;
}

// Analiza una pista del FS virtual (BPM/tono/energía) para el selector del modo auto.
function analyzeTrack(path) {
  const pB = M._malloc(4), pK = M._malloc(4), pO = M._malloc(4), pE = M._malloc(4);
  const pF = M._malloc(8), pL = M._malloc(8);
  M.ccall('dj_analyze_file', 'number', ['string', 'number', 'number', 'number'], [path, pB, pK, pO]);
  M.ccall('dj_analyze_silence', 'number', ['string', 'number', 'number', 'number'], [path, pF, pL, pE]);
  const bpm = M.HEAPF32[pB >> 2], key = M.HEAP32[pK >> 2], energy = M.HEAPF32[pE >> 2];
  M._free(pB); M._free(pK); M._free(pO); M._free(pE); M._free(pF); M._free(pL);
  return { bpm, key, energy };
}

async function onInit(msg) {
  M = await AuditEngine();
  audioF32 = new Float32Array(msg.audio);
  ctrl = new Int32Array(msg.ctrl);
  eng = M.ccall('dj_create', 'number', [], []);
  M.ccall('dj_start', 'number', ['number'], [eng]);
  // Fija la tasa del motor a la real del AudioContext (corrige el tono en 44.1 kHz).
  if (msg.sampleRate > 0)
    M.ccall('dj_set_output_sample_rate', 'void', ['number', 'number'], [eng, msg.sampleRate | 0]);
  autoCtl = M.ccall('dj_auto_create', 'number', ['number'], [eng]);  // modo automatico (P1)
  renderPtr = M._malloc(CHUNK * CHANNELS * 4);
  Atomics.store(ctrl, CTRL.RUN, 1);
  running = true;
  setInterval(statusTick, 200);
  postMessage({ type: 'ready', sampleRate: msg.sampleRate });
  // Arranca el bombeo de audio (cede al event loop en cada tick).
  setTimeout(pump, 0);
}

function writeFile(bytes) {
  const name = `/t${nextFileId++}`;
  M.FS.writeFile(name, new Uint8Array(bytes));
  return name;
}

onmessage = async (e) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init': return void (await onInit(m));
      case 'load': {
        const path = writeFile(m.bytes);
        const ok = M.ccall('dj_load', 'number', ['number', 'number', 'string'], [eng, m.deck, path]);
        let energy = 0;
        if (ok) {  // energía para el copiloto (Modo B)
          const pF = M._malloc(8), pL = M._malloc(8), pE = M._malloc(4);
          M.ccall('dj_analyze_silence', 'number', ['string', 'number', 'number', 'number'], [path, pF, pL, pE]);
          energy = M.HEAPF32[pE >> 2]; M._free(pF); M._free(pL); M._free(pE);
        }
        postMessage({
          type: 'loaded', deck: m.deck, ok, name: m.name,
          dur: M.ccall('dj_duration', 'number', ['number', 'number'], [eng, m.deck]),
          bpm: M.ccall('dj_get_bpm', 'number', ['number', 'number'], [eng, m.deck]),
          key: M.ccall('dj_get_key', 'number', ['number', 'number'], [eng, m.deck]),
          beatOffset: M.ccall('dj_get_beat_offset', 'number', ['number', 'number'], [eng, m.deck]),
          energy,
          wave: ok ? getWaveform(m.deck) : null,
          err: ok ? '' : (M.ccall('dj_last_error', 'string', [], []) || ''),
        });
        break;
      }
      case 'waveform': {
        postMessage({ type: 'waveform', deck: m.deck, wave: getWaveform(m.deck) });
        break;
      }
      case 'analyze': {  // Modo B (copiloto): analiza metadatos sin cargar ni tocar el selector
        const path = writeFile(m.bytes);
        const a = analyzeTrack(path);
        postMessage({ type: 'analyzed', name: m.name, bpm: a.bpm, key: a.key, energy: a.energy, reqId: m.reqId });
        break;
      }
      case 'play':     call('dj_play', ['number', 'number', 'number'], [eng, m.deck, m.on ? 1 : 0]); break;
      case 'seek':     call('dj_seek', ['number', 'number', 'number'], [eng, m.deck, m.s]); break;
      case 'cue':      call('dj_set_cue', ['number', 'number'], [eng, m.deck]); break;
      case 'jumpcue':  call('dj_jump_cue', ['number', 'number'], [eng, m.deck]); break;
      case 'gain':     call('dj_set_gain', ['number', 'number', 'number'], [eng, m.deck, m.v]); break;
      case 'eq':       call('dj_set_eq', ['number', 'number', 'number', 'number', 'number'], [eng, m.deck, m.low, m.mid, m.high]); break;
      case 'filter':   call('dj_set_filter', ['number', 'number', 'number'], [eng, m.deck, m.v]); break;
      case 'fader':    call('dj_set_fader', ['number', 'number', 'number'], [eng, m.deck, m.v]); break;
      case 'rate':     call('dj_set_rate', ['number', 'number', 'number'], [eng, m.deck, m.v]); break;
      case 'keylock':  call('dj_set_keylock', ['number', 'number', 'number'], [eng, m.deck, m.on ? 1 : 0]); break;
      case 'master':   call('dj_set_master', ['number', 'number'], [eng, m.v]); break;
      case 'xfader':   call('dj_set_xfader', ['number', 'number'], [eng, m.x]); break;
      case 'hotcue_set':   call('dj_set_hotcue', ['number', 'number', 'number', 'number'], [eng, m.deck, m.index, m.s]); break;
      case 'hotcue_jump':  call('dj_jump_hotcue', ['number', 'number', 'number'], [eng, m.deck, m.index]); break;
      case 'hotcue_clear': call('dj_clear_hotcue', ['number', 'number', 'number'], [eng, m.deck, m.index]); break;
      case 'loop':     call('dj_set_loop', ['number', 'number', 'number', 'number'], [eng, m.deck, m.on ? 1 : 0, m.bars]); break;
      case 'beatjump': call('dj_beat_jump', ['number', 'number', 'number'], [eng, m.deck, m.beats]); break;
      // ---- Modo automatico (AutoMix+Selector compartidos en WASM, P1) ----
      case 'auto_add': {
        const path = writeFile(m.bytes);
        const a = analyzeTrack(path);
        M.ccall('dj_auto_add_track', 'void', ['number', 'string', 'number', 'number', 'number'],
                [autoCtl, path, a.bpm, a.key, a.energy]);
        postMessage({ type: 'auto_added', name: m.name, bpm: a.bpm, key: a.key, energy: a.energy });
        break;
      }
      case 'auto_transition': call('dj_auto_set_transition', ['number', 'number'], [autoCtl, m.seconds]); break;
      case 'auto_skip':       call('dj_auto_skip', ['number'], [autoCtl]); break;
      case 'auto_enable': {
        if (m.on) {
          const ok = M.ccall('dj_auto_begin', 'number', ['number'], [autoCtl]);
          if (ok && !autoTimer) autoTimer = setInterval(() => M.ccall('dj_auto_tick', 'void', ['number'], [autoCtl]), 50);
          postMessage({ type: 'auto_enabled', ok: !!ok });
        } else {
          if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
          M.ccall('dj_auto_end', 'void', ['number'], [autoCtl]);  // deja de conducir; el audio sigue
          postMessage({ type: 'auto_enabled', ok: false });
        }
        break;
      }
      case 'stop':     running = false; Atomics.store(ctrl, CTRL.RUN, 0); Atomics.notify(ctrl, CTRL.WAKE); break;
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
