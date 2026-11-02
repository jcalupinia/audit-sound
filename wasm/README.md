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

### Hilos (clave)

El `chunk_cache` crea un hilo de decodificación. Crear un hilo **desde el hilo
principal del navegador bloquea** (`Atomics.wait` prohibido en el main thread →
`{"error":"unwind"}`). Por eso la build usa **`-sPROXY_TO_PTHREAD=1`**: el `main`
del motor corre en un worker donde sí se puede bloquear. Requiere servir con
cabeceras de aislamiento de origen (SharedArrayBuffer):

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
Verificado el 2026-11-02: `load=1 dur=6.00 bpm=120.0`, `peak=0.4966` (audio real).

`track.wav` es un binario de prueba local y **no** se versiona (`*.wav` en `.gitignore`).
