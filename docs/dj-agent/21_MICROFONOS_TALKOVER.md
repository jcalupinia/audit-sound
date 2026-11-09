# 21 · Micrófonos en vivo y talkover (servicios reales)

> **Estado:** implementado y probado de extremo a extremo con servicios reales en local (2026-11-09). Pendiente de
> merge y despliegue. Primer punto del orden recomendado (micrófonos → V2 → efectos → V1b/V3).

Antes los canales de micrófono eran solo controles: la consola pedía permiso, pero **la voz no llegaba a la mezcla
ni al stream** y el botón «Talkover» no hacía nada (`INVENTARIO_FRONTEND_VS_BACKEND.md`: 🔴).

## 1. Cómo viaja la voz

```
micrófono ─► consola v0.6 (Web Audio: ganancia, EQ, MUTE por canal, medidor)
               │  «Escuchar en la sala» (opcional) ─► parlantes de este equipo
               │  talkover local ─► atenúa la música del navegador
               ▼  «Enviar al stream»: PCM 16 bits mono en bloques de 100 ms (WebSocket)
proxy /api/v1/dj-agent ─► agente  /sessions/{id}/voice   (solo operador/admin de la organización)
               ▼  POST /api/voice?sr=…  (solo la sesión que controla el motor)
motor C++  VoiceMixer: búfer anti-cortes, remuestreo, talkover ─► mezcla ─► Icecast ─► oyentes
```

- **La música nunca depende de la voz.** Si se corta la red, el agente o el navegador, la voz se detiene sin ruido. El motor sigue con la música.
- **El retraso de la voz no crece:** el motor no acumula más de 0,8 s y el agente descarta lo que pase de 1 s.
- **Talkover:**
  - *Automático:* la música baja 14 dB cuando la voz pasa de −42 dBFS. Vuelve 600 ms después de callar, en ~350 ms.
  - *Siempre:* la música queda atenuada.
  - *Apagado:* la música no se atenúa.
  - En el stream lo aplica el motor; en el equipo del DJ, la consola.

## 2. Qué cambió

| Parte | Archivo | Qué hace |
|---|---|---|
| Motor | `engine/voice/voice_mixer.hpp` (nuevo), `engine/dj_engine.{h,cpp}` | `VoiceMixer` (un productor, el hilo HTTP; un consumidor, el hilo de audio que no se bloquea). API C: `dj_voice_push`, `dj_set_talkover`, `dj_voice_status` |
| Motor (red) | `engine/api/control_api.cpp` | `POST /api/voice?sr=` solo para el controlador. `/api/command?action=talkover&value=0\|1\|2&gain=&duck=`. `/api/status` incluye `"voice"`. Cuerpo máximo de 256 KB (413) |
| Agente | `app/api/v1/ws.py` (`session_voice`), adaptadores, permiso `voice:broadcast` | WebSocket de voz autenticado (4401/4403/4404/4409/4400), cola en orden, descarte por retraso, `voice.stats` cada 1 s, eventos `voice.started`/`voice.stopped` |
| Consola | `web/pro/v06/src/modules/07b-microfonos.js` (nuevo), 01/03/04 | 4 canales reales (entrada, ganancia, agudos, graves, MUTE), medidor, escuchar en la sala, procesamiento de voz (eco/ruido), talkover, «Enviar al stream» con estado en vivo |

## 3. Pruebas

| Prueba | Resultado |
|---|---|
| `voice_test` (motor, nueva): remuestreo 48→44,1 kHz, talkover en los tres modos, recuperación, ráfagas, cortes de red, entradas inválidas, API C | **TODO OK** (17) |
| `control_api_test`: `/api/voice` (controlador 200, otra sesión 409, sin sesión 401, PCM impar 400, frecuencia 400, >256 KB 413), talkover, estado | **51 OK** (9 nuevas) |
| Agente `pytest`: WebSocket de voz (orden, frecuencia, talkover, permisos por rol y organización, bloques inválidos, motor caído) y contrato del adaptador | **256 pasan**, 5 omitidas; `ruff` limpio |
| **E2E con servicios reales** `microfono_stream_e2e.mjs`: Chromium con micrófono simulado → consola → proxy → agente → **motor real** → **Icecast** → un oyente graba el stream | **TODO OK, en 2 corridas seguidas** |
| Regresión de la consola: `agent_live_e2e`, `voice_mobile_e2e`, `video_v1_e2e`, `sesion_real_e2e`, `cc_login_e2e` | **OK** |
| Pantalla de micrófonos en escritorio (1440 px) y teléfono (390 px) | Sin desbordes ni errores |

Lo que mide el oyente en el E2E (amplitud de la música en 220 Hz y de la «voz» en 1 kHz):

| Momento | Música | Voz |
|---|---|---|
| Antes de hablar | 0,229 | 0,000 |
| Hablando (talkover automático) | **0,046** (−14 dB) | **0,449** |
| Después de quitar la voz | 0,229 | 0,000 |

## 4. Pendiente y límites

- **Prueba física pendiente:** micrófonos reales (USB, mezcladora, celular), la latencia que se percibe y el acople con parlantes en un local real. El E2E usa un micrófono simulado.
- Los 4 canales se suman en una sola voz hacia el stream. No hay preescucha separada por canal.
- La voz no pasa por un limitador suave: con talkover apagado y la voz muy fuerte, el motor recorta los picos. Para eso existen el talkover y la ganancia del canal.
- La consola en modo «motor WASM» (audio por el motor del navegador) no atenúa esa música en el equipo local; el stream sí la atenúa.
