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
    this._pending = new Map(); // reqId -> resolve (para analyzeAwait)
    this._reqSeq = 0;
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
    this._buildFxChain();  // worklet -> FX (eco/reverb/filtro) -> salida (+ grabador)

    this.worker = new Worker(new URL('./engine_worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') this.ready = true;
      else if (m.type === 'status' && this.onStatus) this.onStatus(m);
      else if (m.type === 'loaded' && this.onLoaded) this.onLoaded(m);
      else if (m.type === 'waveform' && this.onWaveform) this.onWaveform(m);
      else if (m.type === 'analyzed') {
        // Si la petición esperaba respuesta (analyzeAwait), resuélvela; si no, callback legacy.
        if (m.reqId != null && this._pending.has(m.reqId)) {
          const res = this._pending.get(m.reqId); this._pending.delete(m.reqId); res(m);
        } else if (this.onAnalyzed) this.onAnalyzed(m);
      }
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
  requestWaveform(deck)  { this._send({ type: 'waveform', deck }); }
  // Modo B (copiloto): analiza una pista (bpm/tono/energía) sin cargarla ni ejecutarla.
  async analyze(fileOrBytes, name) {
    const bytes = fileOrBytes instanceof ArrayBuffer ? fileOrBytes : await fileOrBytes.arrayBuffer();
    this._send({ type: 'analyze', bytes, name: name || (fileOrBytes.name || 'track') });
  }
  // Como analyze(), pero devuelve una promesa con {name,bpm,key,energy}. Lo usa la
  // biblioteca persistente para guardar los metadatos de cada pista que añade.
  async analyzeAwait(fileOrBytes, name) {
    const bytes = fileOrBytes instanceof ArrayBuffer ? fileOrBytes : await fileOrBytes.arrayBuffer();
    const reqId = ++this._reqSeq;
    const p = new Promise((resolve) => this._pending.set(reqId, resolve));
    this._send({ type: 'analyze', bytes, name: name || (fileOrBytes.name || 'track'), reqId });
    return p;
  }

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

  // ====== FX de máster + grabación (P2b) — grafo de Web Audio en el hilo principal ======
  // worklet -> fxIn -> [seco + eco + reverb] -> fxSum -> filtro -> salida (y grabador).
  _buildFxChain() {
    const ctx = this.ctx;
    const fxIn = ctx.createGain();
    this.node.connect(fxIn);

    // Seco
    const dry = ctx.createGain(); dry.gain.value = 1;
    fxIn.connect(dry);

    // Eco (delay con realimentación)
    const delay = ctx.createDelay(2.0); delay.delayTime.value = 0.375;  // ~3/16 a 120 BPM
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    const echoWet = ctx.createGain(); echoWet.gain.value = 0;           // apagado por defecto
    fxIn.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(echoWet);

    // Reverb (convolución con impulso generado)
    const conv = ctx.createConvolver(); conv.buffer = this._makeImpulse(2.2, 2.5);
    const revWet = ctx.createGain(); revWet.gain.value = 0;
    fxIn.connect(conv); conv.connect(revWet);

    // Suma + filtro de máster (barrido) + salida
    const sum = ctx.createGain();
    dry.connect(sum); echoWet.connect(sum); revWet.connect(sum);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.value = 20000; filter.Q.value = 0.7;
    sum.connect(filter);
    filter.connect(ctx.destination);

    // Destino de grabación (captura el máster)
    const recDest = ctx.createMediaStreamDestination();
    filter.connect(recDest);

    this._fx = { fxIn, dry, delay, fb, echoWet, conv, revWet, sum, filter, recDest };
    this._rec = null; this._recChunks = [];
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.max(1, (rate * seconds) | 0);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // amount 0..1 (mezcla húmeda del eco)
  fxEcho(amount) { if (this._fx) this._fx.echoWet.gain.value = Math.max(0, Math.min(1, amount)); }
  fxEchoTime(seconds) { if (this._fx) this._fx.delay.delayTime.value = Math.max(0.01, Math.min(2, seconds)); }
  // amount 0..1 (mezcla húmeda de la reverb)
  fxReverb(amount) { if (this._fx) this._fx.revWet.gain.value = Math.max(0, Math.min(1, amount)); }
  // x en [-1,1]: 0 = abierto; <0 pasa-bajos cerrando; >0 pasa-altos abriendo.
  fxFilter(x) {
    if (!this._fx) return; const f = this._fx.filter, ny = this.ctx.sampleRate / 2;
    if (x >= -0.02 && x <= 0.02) { f.type = 'lowpass'; f.frequency.value = Math.min(20000, ny); return; }
    if (x < 0) { f.type = 'lowpass'; f.frequency.value = 20000 * Math.pow(0.0015, -x); }
    else { f.type = 'highpass'; f.frequency.value = 20 * Math.pow(1000, x); }
  }

  // Grabación de la sesión (máster). Devuelve true si arrancó.
  recordStart() {
    if (!this._fx || this._rec) return false;
    const mime = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    this._recChunks = [];
    this._rec = new MediaRecorder(this._fx.recDest.stream, { mimeType: mime });
    this._rec.ondataavailable = (e) => { if (e.data && e.data.size) this._recChunks.push(e.data); };
    this._rec.start();
    return true;
  }

  // Detiene y devuelve un Blob con la grabación (o null).
  async recordStop() {
    if (!this._rec) return null;
    const rec = this._rec; this._rec = null;
    const done = new Promise((res) => { rec.onstop = res; });
    rec.stop(); await done;
    return new Blob(this._recChunks, { type: rec.mimeType });
  }
  recording() { return !!this._rec; }
}
