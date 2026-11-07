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
import * as SEARCH from '../../search.js';
import * as OM from '../../openmusic.js';
import * as IA from '../../archive.js';

// Instancia única del copiloto (recomendador Camelot/BPM/energía, puro y local) y la
// biblioteca persistente (IndexedDB). app.js los consume vía window.__ASLive.
const copilot = new Copilot();

// Proveedores de búsqueda de música de uso libre, reutilizando los módulos ya probados.
// openmusic (Jamendo) e Internet Archive van por los proxies del servidor (/api/*), que
// se habilitan con las claves/flags del servidor. Sin ellas, enabled()=false y la UI lo dice.
function searchProviders() {
  return [
    { source: 'libre', label: 'Música libre', enabled: OM.enabled(),
      search: async (q, n, sig) => (await OM.search(q, n, sig)).map((s) => SEARCH.normLibre(s, OM.filename(s))) },
    { source: 'archive', label: 'Internet Archive', enabled: IA.enabled(),
      search: async (q, n, sig) => (await IA.search(q, n, sig)).map((s) => SEARCH.normArchive(s, IA.filename(s))) },
  ];
}

window.__ASLive = {
  copilot,
  lib: LIB,
  camelot,
  searchProviders,
  searchAll: (q, opts) => SEARCH.searchAll(q, opts),
  fmtDuration: SEARCH.fmtDuration,
  // Trae los bytes del audio de un resultado (por el proxy del servidor).
  async searchBytesOf(r) {
    if (!r) return null;
    if (r.source === 'libre') return OM.getBytes(r._raw && r._raw.audio);
    if (r.source === 'archive') return IA.getBytes(r.id);
    return null;
  },
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
