# AUDIT SOUND

**DJ autónomo** que corre en el servidor, mezcla desde una biblioteca propia
(Navidrome/Subsonic) y **transmite el audio ya mezclado** a una app web
(www.audit-ia) donde el usuario entra con usuario y clave y lo escucha/controla
desde cualquier navegador (iPhone, Android, computadora).

Arquitectura **Opción B** (motor en servidor + streaming), elegida en la fase 1
de auditoría técnica. El motor es un **fork del motor C++ de
[SideDeck](https://github.com/manueljpy/SideDeck)**, adaptado para correr headless
en Linux y emitir su salida como stream MP3 vía Icecast, en lugar de reproducir
por Oboe (Android).

> **Estado:** andamiaje inicial (issue **A1**). Todavía **no** compila ni funciona
> como producto: el cableado de build para Linux, el sink de streaming y el
> cerebro autónomo llegan en los issues siguientes (C1, D1/D2, M3…). Ver el plan.

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
