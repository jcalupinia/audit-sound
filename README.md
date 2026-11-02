# AUDIT SOUND

**DJ autónomo** que corre en el servidor, mezcla desde una biblioteca propia
(Navidrome/Subsonic) y **transmite el audio ya mezclado** a una app web
(escuchar.audit-ia.ec) donde el usuario entra con usuario y clave y lo escucha/controla
desde cualquier navegador (iPhone, Android, computadora).

Arquitectura **Opción B** (motor en servidor + streaming), elegida en la fase 1
de auditoría técnica. El motor es un **fork del motor C++ de
[SideDeck](https://github.com/manueljpy/SideDeck)**, adaptado para correr headless
en Linux y emitir su salida como stream MP3 vía Icecast, en lugar de reproducir
por Oboe (Android).

> **Estado:** issues **A1** (andamiaje) y **C1** (build headless en Linux)
> completados. El motor **compila y corre headless en Linux sin Oboe** y
> reproduce audio a través de un `OfflineSink` de pruebas (ver más abajo). Falta
> el sink de streaming (MP3 → Icecast, D1/D2) y el cerebro autónomo (M3). No es
> aún un producto; es la base verificada del runtime.

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
  sinks/         Backends de salida (StreamSink, etc.) — a implementar
third_party/     Dependencias vendorizadas (qm-dsp, Signalsmith, dr_libs,
                 opus/ogg/opusfile). Oboe se excluye a propósito (Android-only).
deploy/          Despliegue en Coolify (Icecast, Navidrome, compose) — a implementar
web/             App web de prueba y, luego, el frontend — a implementar
```

## Hoja de ruta (MVP — fase 2, Opción B)

- **M1** *Vertical slice*: el motor headless emite un archivo en bucle como stream
  MP3 por Icecast y suena en segundo plano (pantalla bloqueada) en iPhone
  (Safari/WebKit) y Android (Chrome). Retira el riesgo de background-audio en iOS.
- **M2** Decodificación completa (incl. AAC/M4A vía FFmpeg) + catálogo Navidrome +
  análisis (BPM/tonalidad/silencio/energía) cacheado.
- **M3** AutoMix (port del Auto DJ de Mixxx) + continuidad + sync de tempo.
- **M4** Selector musical inteligente (armonía Camelot + BPM + energía + anti-repetición).
- **M5** Login + Control API (WebSocket) + frontend web.
- **M6** Multi-dispositivo / handoff.
- **M7** Endurecimiento, dimensionamiento y despliegue → MVP.

El detalle completo está en los documentos de planificación de la auditoría.

## Atribución

Motor forkeado de SideDeck (GPLv3). Código de Mixxx (GPLv2+) portado en
`engine/beat_utils.hpp`, partes de `engine/dj_engine.cpp` y el futuro AutoMix.
Ver [`NOTICE`](NOTICE).
