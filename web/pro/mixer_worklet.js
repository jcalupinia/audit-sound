// AudioWorkletProcessor consumidor: lee PCM interleaved estéreo del ring buffer
// (SharedArrayBuffer) que llena el Worker del motor y lo entrega a la salida de
// Web Audio. No instancia WASM: solo copia y sincroniza con Atomics. Así el hilo
// de audio nunca decodifica ni bloquea.
const CTRL = { WRITE: 0, READ: 1, WAKE: 2, PEAK: 3, RUN: 4, UNDER: 5 };
const CHANNELS = 2;

class MixerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { audio, ctrl, ringFrames } = options.processorOptions;
    this.audio = new Float32Array(audio);
    this.ctrl = new Int32Array(ctrl);
    this.ringFrames = ringFrames;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0], right = out[1] || out[0];
    const frames = left.length;              // normalmente 128
    const ctrl = this.ctrl, ring = this.ringFrames;

    let w = Atomics.load(ctrl, CTRL.WRITE);
    let r = Atomics.load(ctrl, CTRL.READ);
    const avail = w - r;

    if (avail < frames) {
      // Underrun: no hay suficiente audio aún. Silencio en este quantum.
      for (let i = 0; i < frames; i++) { left[i] = 0; if (right !== left) right[i] = 0; }
      Atomics.add(ctrl, CTRL.UNDER, 1);
      Atomics.add(ctrl, CTRL.WAKE, 1);
      Atomics.notify(ctrl, CTRL.WAKE);
      return true;
    }

    let peakI = Atomics.load(ctrl, CTRL.PEAK);
    let peak = peakI / 1e6;
    for (let i = 0; i < frames; i++) {
      const idx = ((r + i) % ring) * CHANNELS;
      const l = this.audio[idx], rr = this.audio[idx + 1];
      left[i] = l;
      if (right !== left) right[i] = rr;
      const a = Math.abs(l), b = Math.abs(rr);
      if (a > peak) peak = a;
      if (b > peak) peak = b;
    }
    Atomics.store(ctrl, CTRL.READ, r + frames);
    Atomics.store(ctrl, CTRL.PEAK, Math.round(peak * 1e6));
    // Despierta al productor para que rellene lo consumido.
    Atomics.add(ctrl, CTRL.WAKE, 1);
    Atomics.notify(ctrl, CTRL.WAKE);
    return true;
  }
}

registerProcessor('mixer-processor', MixerProcessor);
