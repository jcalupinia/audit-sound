// Puente de audio del modo PRO (hilo principal). Orquesta:
//   - AudioContext + AudioWorkletNode('mixer-processor')  -> salida del navegador
//   - Worker del motor (engine_worker.js)                 -> produce PCM al ring
//   - ring buffer SharedArrayBuffer compartido por ambos
// Expone una API JS para la UI. El motor WASM nunca toca el hilo de audio.
import { makeSharedBuffers, RING_FRAMES } from './ring.js';

export class AudioBridge {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.worker = null;
    this.ready = false;
    this.onStatus = null;      // callback({decks, under})
    this.onLoaded = null;      // callback({deck, ok, name, dur, bpm, key, err})
    this.onError = null;       // callback(message)
    this._buffers = makeSharedBuffers();
  }

  // Debe llamarse desde un gesto del usuario (click) para cumplir la política de autoplay.
  async start() {
    if (this.ready) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    await this.ctx.audioWorklet.addModule(new URL('./mixer_worklet.js', import.meta.url));

    this.node = new AudioWorkletNode(this.ctx, 'mixer-processor', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { audio: this._buffers.audio, ctrl: this._buffers.ctrl, ringFrames: RING_FRAMES },
    });
    this.node.connect(this.ctx.destination);

    this.worker = new Worker(new URL('./engine_worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') this.ready = true;
      else if (m.type === 'status' && this.onStatus) this.onStatus(m);
      else if (m.type === 'loaded' && this.onLoaded) this.onLoaded(m);
      else if (m.type === 'auto_added' && this.onAutoAdded) this.onAutoAdded(m);
      else if (m.type === 'auto_enabled' && this.onAutoEnabled) this.onAutoEnabled(m);
      else if (m.type === 'error' && this.onError) this.onError(m.message);
    };
    this.worker.postMessage({
      type: 'init', audio: this._buffers.audio, ctrl: this._buffers.ctrl,
      sampleRate: this.ctx.sampleRate,
    });

    // Espera el 'ready' del Worker (hasta 10 s).
    const t0 = performance.now();
    while (!this.ready && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 30));
    if (!this.ready) throw new Error('el motor WASM no respondió');
  }

  _send(msg) { if (this.worker) this.worker.postMessage(msg); }

  // Carga un archivo (File/Blob/ArrayBuffer) en un plato.
  async load(deck, fileOrBytes, name) {
    const bytes = fileOrBytes instanceof ArrayBuffer ? fileOrBytes : await fileOrBytes.arrayBuffer();
    this._send({ type: 'load', deck, bytes, name: name || (fileOrBytes.name || `deck${deck}`) });
  }

  play(deck, on)         { this._send({ type: 'play', deck, on }); }
  seek(deck, s)          { this._send({ type: 'seek', deck, s }); }
  cue(deck)              { this._send({ type: 'cue', deck }); }
  jumpCue(deck)          { this._send({ type: 'jumpcue', deck }); }
  gain(deck, v)          { this._send({ type: 'gain', deck, v }); }
  eq(deck, low, mid, high){ this._send({ type: 'eq', deck, low, mid, high }); }
  filter(deck, v)        { this._send({ type: 'filter', deck, v }); }
  fader(deck, v)         { this._send({ type: 'fader', deck, v }); }
  rate(deck, v)          { this._send({ type: 'rate', deck, v }); }
  keylock(deck, on)      { this._send({ type: 'keylock', deck, on }); }
  master(v)              { this._send({ type: 'master', v }); }
  xfader(x)              { this._send({ type: 'xfader', x }); }
  hotcueSet(deck, i, s)  { this._send({ type: 'hotcue_set', deck, index: i, s }); }
  hotcueJump(deck, i)    { this._send({ type: 'hotcue_jump', deck, index: i }); }
  hotcueClear(deck, i)   { this._send({ type: 'hotcue_clear', deck, index: i }); }
  loop(deck, on, bars)   { this._send({ type: 'loop', deck, on, bars }); }
  beatjump(deck, beats)  { this._send({ type: 'beatjump', deck, beats }); }

  // ---- Modo automático (AutoMix+Selector compartidos en WASM, P1) ----
  // Añade una pista a la biblioteca del selector (File/Blob/ArrayBuffer).
  async autoAdd(fileOrBytes, name) {
    const bytes = fileOrBytes instanceof ArrayBuffer ? fileOrBytes : await fileOrBytes.arrayBuffer();
    this._send({ type: 'auto_add', bytes, name: name || (fileOrBytes.name || 'track') });
  }
  autoTransition(seconds) { this._send({ type: 'auto_transition', seconds }); }
  autoSkip()              { this._send({ type: 'auto_skip' }); }
  // Enciende/apaga el DJ automático sin cortar el audio (al apagar, el DJ toma el control).
  autoEnable(on)          { this._send({ type: 'auto_enable', on }); }

  stop() { this._send({ type: 'stop' }); }
}
