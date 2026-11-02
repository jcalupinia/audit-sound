# Motor AUDIT SOUND en WebAssembly (modo PRO / mezcla manual)

Compila el motor de audio (`engine/dj_engine.cpp`) a WebAssembly para que corra
**dentro del navegador** y alimente un `AudioWorklet` de Web Audio. Es la base del
mezclador profesional manual (2 platos, hotcues, loops, beatjump, FX, grabación,
MIDI) y del conmutador AUTO/IA.

A diferencia del motor de servidor (Icecast + MP3), aquí no hay dependencias de
servidor (lame/shout/curl/microhttpd/FFmpeg). Formatos: MP3, WAV, FLAC, Opus. **AAC
no está disponible en WASM** (FFmpeg queda fuera de esta build; en el servidor sí).

## Requisitos

- Emscripten SDK (probado con 6.0.13). `source <emsdk>/emsdk_env.sh`.
- Node (para los verificadores) y Chromium (en este entorno: `/opt/pw-browsers/chromium`).

## Compilar

```bash
source /ruta/a/emsdk/emsdk_env.sh
cd wasm
mkdir -p build && cd build
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --target audit_engine -j4      # módulo para el frontend
cmake --build . --target audit_selftest -j4    # autoprueba .html (opcional)
```

Salida de `audit_engine`: `audit_engine.js` (MODULARIZE, `EXPORT_NAME=AuditEngine`)
+ `audit_engine.wasm`. El frontend hace `AuditEngine().then(M => …)` y llama al motor
por `M.ccall(...)`. El render lo pide el AudioWorklet vía `dj_render(engine, out, frames, channels)`.

### Single-thread (clave)

En el servidor/Android el `chunk_cache` decodifica en un hilo de fondo. En el
navegador **no se puede crear un `std::thread` desde el hilo que instancia el
runtime** sin caer en `{"error":"unwind"}` (`Atomics.wait` prohibido ahí). Por eso
en WASM se usa `engine/chunk_cache_ram.hpp`: **sin hilos**, decodifica la pista
completa a RAM en `open()` y la sirve por interpolación lineal (igual que la ruta de
servidor). El motor WASM es single-thread; la ruta con hilos queda intacta para
servidor y Android (`#ifdef __EMSCRIPTEN__` en `chunk_cache.hpp`).

Dos detalles de build obligatorios:

- **`-sSTACK_SIZE=8MB`**: el análisis BPM/key de qm-dsp usa buffers grandes en la
  pila; el stack por defecto de Emscripten (64 KB) se desborda (segfault en `fopen`
  durante `decodeAnalyzeMono`). Con pthreads no se veía porque el pthread traía un
  stack amplio.
- **Cabeceras de aislamiento de origen**: el *puente de audio* (ver `web/pro/`)
  comparte un ring buffer `SharedArrayBuffer` entre el Worker del motor y el
  AudioWorklet, así que la página debe servirse con:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Verificar (prueba empírica de que produce audio real)

La autoprueba (`wasm_selftest.cpp`) carga `/track.wav` embebido, reproduce, renderiza
30 bloques y reporta el pico del PCM. Se corre en Chromium porque los hilos no
funcionan igual bajo Node.

```bash
cd wasm
cp /ruta/a/un_audio.wav track.wav     # cualquier WAV de prueba (ignorado por git)
cd build && cmake --build . --target audit_selftest -j4 && cd ..
node serve_coop.js build 8099 &        # sirve con COOP/COEP
node browser_selftest.js               # espera 'SELFTEST_RESULT peak=…' en consola
```

Resultado esperado: `WASM ENGINE OK (audio real en el navegador)` con `peak > 0.01`.
Verificado el 2026-11-02 (single-thread + stack 8 MB): `load=1 dur=6.00 bpm=120.0`,
`peak=0.4938` (audio real).

`track.wav` es un binario de prueba local y **no** se versiona (`*.wav` en `.gitignore`).

## Puente de audio del mezclador (web/pro/)

`web/pro/` contiene el puente que lleva el motor WASM a Web Audio:

- `engine_worker.js` — Worker que instancia el motor, procesa comandos (load/play/
  eq/filter/rate/hotcue/loop/beatjump…) y **produce** PCM con `dj_render` a un ring
  buffer. Cede al event loop en cada tick (no bloquea la cola de mensajes).
- `ring.js` — layout del ring buffer `SharedArrayBuffer` (float32 interleaved estéreo
  + índices de control atómicos).
- `mixer_worklet.js` — `AudioWorkletProcessor` que **consume** del ring y entrega a la
  salida. No toca WASM: el hilo de audio nunca decodifica ni bloquea.
- `audio_bridge.js` — orquestador del hilo principal (`AudioBridge`): AudioContext +
  AudioWorkletNode + Worker + ring. API para la UI (`load/play/eq/xfader/hotcue…`).

Verificación del puente completo (motor → ring → worklet → salida):

```bash
cd wasm
cp ../wasm/build/audit_engine.js ../wasm/build/audit_engine.wasm ../web/pro/
cp /ruta/a/audio.wav ../web/pro/track.wav
node serve_coop.js ../web/pro 8099 &
node ../web/pro/bridge_browser_test.js   # espera 'BRIDGE_RESULT peak=…'
```

Resultado esperado: `PUENTE DE AUDIO OK (motor WASM -> worklet -> salida)`.
Verificado el 2026-11-02: `loaded ok=1 dur=6.00 bpm=120.0`, `BRIDGE_RESULT peak=0.4938`.

`audit_engine.js`, `audit_engine.wasm` (artefactos de build) y `track.wav` no se
versionan: se generan/copian localmente. En despliegue, el paso de build del
frontend copia `audit_engine.*` a `web/pro/`.
