# engine/sinks

Backends de salida del motor (implementaciones de `IAudioSink`).

El motor produce audio en `renderInterleaved(float* out, int frames, int channels)`
y un *sink* lo consume. La abstracción `IAudioSink` se introduce en el issue **C2**
(refactor que desacopla la salida del motor, hoy acoplada a Oboe en
`../dj_engine.cpp`).

Sinks previstos:

- **`StreamSink`** (issues D1/D2): `renderInterleaved` → MP3 (libmp3lame) →
  Icecast (libshout). Es el sink del servidor en la arquitectura Opción B.
- `OboeSink` (opcional, solo si alguna vez se compila para Android): mover aquí el
  código Oboe que hoy vive inline en `../dj_engine.cpp`.
- `CoreAudioSink` / `WebAudioSink`: solo si se abordan las fases nativas/WASM.

> Carpeta vacía por ahora (andamiaje de A1).
