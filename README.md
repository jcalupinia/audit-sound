# AUDIT SOUND

**DJ autónomo** que corre en el servidor, mezcla desde una biblioteca propia
(Navidrome/Subsonic) y **transmite el audio ya mezclado** a una app web
(audit-sound.audit-ia.ec) donde el usuario entra con usuario y clave y lo escucha/controla
desde cualquier navegador (iPhone, Android, computadora).

Arquitectura **Opción B** (motor en servidor + streaming), elegida en la fase 1
de auditoría técnica. El motor es un **fork del motor C++ de
[SideDeck](https://github.com/manueljpy/SideDeck)**, adaptado para correr headless
en Linux y emitir su salida como stream MP3 vía Icecast, en lugar de reproducir
por Oboe (Android).

> **Estado:** **M1–M5 implementados y verificados.** El motor compila y corre
> headless en Linux (sin Oboe), decodifica WAV/MP3/FLAC/Ogg/AAC, encodea MP3 y
> transmite por **Icecast** (sinks D1/D2); tiene **AutoMix** (M3), **selector
> inteligente** (M4) y **Control API + frontend web** (M5). Además hay un
> **mezclador PRO en el navegador** (motor compilado a **WebAssembly**) con
> biblioteca persistente (IndexedDB), carga desde **Navidrome/Subsonic** y música
> libre (**Jamendo**), y un **convertidor a Opus** (WebCodecs). El despliegue en
> Coolify (streaming en un solo dominio, `deploy/`) está listo. **Pendiente:** la
> puesta en producción y el gate M1 en dispositivo real (audio con pantalla
> bloqueada en iPhone/Android), más M6 (handoff) y M7 (endurecimiento) — ver la
> hoja de ruta.

## Compilar y probar (Linux)

Requisitos del sistema: `cmake`, `g++`, `pkg-config`, **`libmp3lame-dev`** (encoder
MP3, D1), **`libshout3-dev`** (source client de Icecast, D2), **FFmpeg dev**
(`libavcodec/libavformat/libavutil/libswresample-dev`, decodificación AAC/M4A, M2).

```bash
sudo apt-get install -y cmake g++ pkg-config libmp3lame-dev libshout3-dev \
     libavcodec-dev libavformat-dev libavutil-dev libswresample-dev \
     libcurl4-openssl-dev libmicrohttpd-dev
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j"$(nproc)"

./build/engine_selftest                      # arranque headless del motor + sink
./build/engine_selftest ruta/al/audio.wav    # carga, reproduce y avanza posición

# Volcar PCM crudo (float32 intercalado) para inspección:
AUDIT_SOUND_PCM_OUT=/tmp/out.pcm ./build/engine_selftest ruta/al/audio.wav

# Codificar la salida a MP3 a disco (D1) y verificar que es válido:
AUDIT_SOUND_MP3_OUT=/tmp/out.mp3 ./build/engine_selftest ruta/al/audio.wav
./build/mp3_verify /tmp/out.mp3
```

### Transmitir a Icecast (D2)

El sink de salida se elige por variables de entorno. Con las de Icecast, el motor
publica el MP3 como *source client* (en producción, un Icecast en Coolify/Hetzner):

```bash
export AUDIT_SOUND_ICECAST_HOST=localhost
export AUDIT_SOUND_ICECAST_PORT=8900
export AUDIT_SOUND_ICECAST_MOUNT=/stream.mp3
export AUDIT_SOUND_ICECAST_USER=source
export AUDIT_SOUND_ICECAST_PASSWORD=<source-password>
./build/engine_selftest ruta/al/audio.wav
# El stream se escucha en http://<host>:<port>/stream.mp3 (navegador, <audio>, etc.)
```

Prioridad de sinks: `ICECAST_HOST` → Icecast (D2); si no, `MP3_OUT` → MP3 a disco
(D1); si no, `OfflineSink` (pruebas).

## Licencia

Software libre bajo **GNU GPL v3 o posterior** (ver [`LICENSE`](LICENSE)).
AUDIT SOUND es una obra derivada de SideDeck. Las atribuciones y licencias de
terceros están en [`NOTICE`](NOTICE).

## Estructura del repositorio

```
engine/          Motor de audio C++ (fork de SideDeck native/engine)
  sinks/         Backends de salida (MP3, Icecast, OfflineSink) — D1/D2
  automix/       AutoMix (port del Auto DJ de Mixxx) — M3
  selector/      Selector inteligente (Camelot + BPM + energía) — M4
wasm/            Build del motor a WebAssembly (mezclador PRO en el navegador)
third_party/     Dependencias vendorizadas (qm-dsp, Signalsmith, dr_libs,
                 opus/ogg/opusfile). Oboe se excluye a propósito (Android-only).
deploy/          Despliegue en Coolify: mezclador PRO (deploy/pro) y streaming
                 (Icecast + engine + web). Guías: COOLIFY_GUIA.md, PROBAR_IPHONE.md
web/             Frontend: consola de streaming (web/) y mezclador PRO (web/pro/)
```

## Hoja de ruta (MVP — fase 2, Opción B)

- ✅ **M1** *Vertical slice*: el motor headless emite un stream MP3 por Icecast; la
  web lo reproduce con `<audio>` + Media Session. **Código listo**; el gate que retira
  el riesgo de background-audio en iOS se confirma en **dispositivo real** (pendiente).
- ✅ **M2** Decodificación completa (incl. AAC/M4A vía FFmpeg) + catálogo Navidrome +
  análisis (BPM/tonalidad/silencio/energía) cacheado.
- ✅ **M3** AutoMix (port del Auto DJ de Mixxx) + continuidad + sync de tempo.
- ✅ **M4** Selector musical inteligente (armonía Camelot + BPM + energía + anti-repetición).
- ✅ **M5** Login + Control API + frontend web (y mezclador PRO en WebAssembly).
- ⬜ **M6** Multi-dispositivo / handoff (el streaming ya es multi-dispositivo; falta el
  traspaso de *control* — hoy la Control API usa un token compartido).
- ⬜ **M7** Endurecimiento, dimensionamiento y despliegue en producción → MVP.

El detalle completo está en los documentos de planificación de la auditoría.

## Atribución

Motor forkeado de SideDeck (GPLv3). Código de Mixxx (GPLv2+) portado en
`engine/beat_utils.hpp`, partes de `engine/dj_engine.cpp` y el futuro AutoMix.
Ver [`NOTICE`](NOTICE).
