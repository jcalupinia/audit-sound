// AUDIT SOUND · v0.6 — Puente al MOTOR REAL (WASM) del Command Center Pro.
// Este es el único archivo "módulo ES" del v0.6: importa el AudioBridge ya probado
// (web/pro/audio_bridge.js → engine_worker.js → WASM + AudioWorklet + SharedArrayBuffer)
// y lo expone como una fábrica global para que app.js (script clásico) lo use SIN
// rediseñar nada del frontend. El audio real sale del motor, no de los <audio> de la demo.
//
// Requisitos de ejecución: la página debe servirse con cabeceras COOP/COEP
// (crossOriginIsolated === true). deploy/pro/server.js ya las añade a /pro y /v06.
import { AudioBridge } from '../../audio_bridge.js';
import { Copilot, camelot } from '../../copilot.js';
import * as LIB from '../../library.js';

// Instancia única del copiloto (recomendador Camelot/BPM/energía, puro y local) y la
// biblioteca persistente (IndexedDB). app.js los consume vía window.__ASLive.
const copilot = new Copilot();

window.__ASLive = {
  copilot,
  lib: LIB,
  camelot,
  /** Crea y arranca un motor. Llamar desde un gesto del usuario (click). */
  async create({ onStatus, onLoaded, onError } = {}) {
    const bridge = new AudioBridge();
    bridge.onStatus = onStatus || null;
    bridge.onLoaded = onLoaded || null;
    bridge.onError = onError || ((e) => console.warn('engine:', e));
    await bridge.start(); // crea AudioContext + Worker + Worklet y espera a WASM listo
    return bridge;
  },
};
