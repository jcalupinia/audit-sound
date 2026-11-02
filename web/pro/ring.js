// Ring buffer PCM compartido (SharedArrayBuffer) entre el Worker del motor
// (productor: llama dj_render) y el AudioWorklet (consumidor: copia a la salida).
// Formato: float32 interleaved estéreo. Índices monotónicos en cuadros (frames).
//
// Layout del SAB de control (Int32Array):
//   [0] WRITE  cuadros escritos (monotónico)
//   [1] READ   cuadros leídos   (monotónico)
//   [2] WAKE   contador que el worklet incrementa al consumir (para Atomics.wait)
//   [3] PEAK   pico del PCM consumido * 1e6 (solo diagnóstico/medición)
//   [4] RUN    1 mientras el puente está activo
//   [5] UNDER  conteo de underruns (el worklet pidió audio y no había)
export const CTRL = { WRITE: 0, READ: 1, WAKE: 2, PEAK: 3, RUN: 4, UNDER: 5, LEN: 6 };
export const CHANNELS = 2;

// Capacidad del anillo en cuadros (potencia de 2 recomendada). ~0.68 s a 48 kHz.
export const RING_FRAMES = 32768;

export function makeSharedBuffers() {
  const audio = new SharedArrayBuffer(RING_FRAMES * CHANNELS * 4);
  const ctrl = new SharedArrayBuffer(CTRL.LEN * 4);
  return { audio, ctrl };
}
