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

const CHUNK = 2048;                 // cuadros por llamada a dj_render
let renderPtr = 0;                  // buffer en el heap WASM para dj_render

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
  while (running && freeFrames() >= CHUNK) {
    M.ccall('dj_render', 'number', ['number', 'number', 'number', 'number'],
            [eng, renderPtr, CHUNK, CHANNELS]);
    pushToRing(CHUNK);
  }
  setTimeout(pump, 5);
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
  }));
  postMessage({ type: 'status', decks, under: Atomics.load(ctrl, CTRL.UNDER) });
}

const call = (fn, sig, args) => M.ccall(fn, 'void', sig, args);

async function onInit(msg) {
  M = await AuditEngine();
  audioF32 = new Float32Array(msg.audio);
  ctrl = new Int32Array(msg.ctrl);
  eng = M.ccall('dj_create', 'number', [], []);
  M.ccall('dj_start', 'number', ['number'], [eng]);
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
        postMessage({
          type: 'loaded', deck: m.deck, ok, name: m.name,
          dur: M.ccall('dj_duration', 'number', ['number', 'number'], [eng, m.deck]),
          bpm: M.ccall('dj_get_bpm', 'number', ['number', 'number'], [eng, m.deck]),
          key: M.ccall('dj_get_key', 'number', ['number', 'number'], [eng, m.deck]),
          err: ok ? '' : (M.ccall('dj_last_error', 'string', [], []) || ''),
        });
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
      case 'stop':     running = false; Atomics.store(ctrl, CTRL.RUN, 0); Atomics.notify(ctrl, CTRL.WAKE); break;
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
