# 22 · Efectos de audio reales (bancos FX)

> **Estado:** implementado y probado de extremo a extremo con servicios reales en local (2026-11-09). Pendiente de
> merge y despliegue. Tercer punto del orden recomendado (micrófonos → V2 → **efectos** → V1b/V3).

Antes los bancos FX de la consola solo guardaban la configuración: el aviso decía «no procesa efectos por sí solo;
conectar DSP al motor». Ahora suenan en el stream.

## 1. Cómo funciona

```
consola v0.6 · bancos FX ─► agente  POST /sessions/{id}/commands {action:"fx", …}  (lista blanca, operador/admin)
                         ─► motor   /api/command?action=fx&bank=…  ─► fx::Rack ─► mezcla ─► Icecast
```

- **2 bancos.** Cada uno aplica un efecto a un destino:
  - **Deck A** o **Deck B**: antes del crossfader, como en un mezclador DJ.
  - **Salida general**: después de la mezcla y **antes de la voz en vivo**, para que el locutor no salga con eco.
- **Efectos y su control principal:**

| Efecto | Control principal |
|---|---|
| Eco (realimentación 0,5, agudos amortiguados) | Tiempo |
| Delay ping-pong | Tiempo |
| Reverb (tipo Freeverb) | Tamaño de sala |
| Filtro DJ | Izquierda: pasa-bajos · derecha: pasa-altos · centro: neutro |
| Flanger | Velocidad |
| Phaser | Velocidad |
| Bitcrusher | Intensidad: menos bits y menos muestras |

- **Sincronía al BPM:**
  - Eco y delay: 1/4, 1/2, 3/4, 1, 1½ o 2 pulsos del deck.
  - Flanger y phaser: un ciclo cada 1, 2, 4 u 8 pulsos.
- **Sin chasquidos:** la mezcla y la frecuencia del filtro cambian con una rampa de ~10 ms, y el tiempo del eco cambia de forma suave.
- **Cambiar de efecto limpia el estado:** el eco anterior no se cuela en el efecto nuevo.
- **Seguridad:**
  - Los efectos los manejan personas (operador/admin con control de la sesión). El comando `fx` **no** está en los niveles de autonomía del agente.
  - El motor responde `400` a bancos, tipos o destinos inválidos.
  - Un motor sin efectos (versión anterior) responde `capability_unavailable`.

## 2. Qué cambió

| Parte | Archivo |
|---|---|
| Motor | `engine/fx/fx_rack.hpp` (nuevo), `engine/dj_engine.{h,cpp}`: `dj_set_fx`, `dj_get_fx`, procesamiento por deck y en la salida general |
| Control API | `engine/api/control_api.cpp`: `action=fx` y `"fx"` en `/api/status` |
| Agente | `app/domain/commands.py` (`FxP`, comando `fx` con capacidad `fx`), adaptadores real y simulado |
| Consola | `web/pro/v06/src/modules/07d-efectos.js` (nuevo): la pantalla «Efectos FX» envía cada cambio al motor (deslizadores cada 150 ms como máximo), muestra «SONANDO EN EL STREAM», el error si lo hay y el valor real del control. Se quitaron «Custom» y los destinos MIC/Video, que el motor no tiene |

## 3. Pruebas

| Prueba | Resultado |
|---|---|
| `fx_test` (nueva): eco a 500 ms con 120 BPM y 1 pulso, repeticiones que se apagan, ping-pong, cola de reverb que se apaga, filtro (pasa-bajos −40 dB a 5 kHz; pasa-altos −49 dB a 100 Hz; neutro en 0,5), flanger/phaser estables, bitcrush a 4 bits (9 niveles), mezcla 0 y banco apagado intactos, sin salto al encender, cambio de efecto limpio, destino A no toca B, API C | **TODO OK** (25) |
| `control_api_test`: `fx` (eco en A, estado de los 2 bancos, apagar conserva el resto, inválidos 400, solo controlador 409) | **56 OK** |
| Agente `pytest`: `fx` llega y se confirma, 7 casos inválidos (422), solo operadores (403), motor sin efectos (409), adaptador con booleanos 0/1 | **267 pasan** |
| **E2E con servicios reales** `efectos_stream_e2e.mjs`: consola → agente → **motor real → Icecast → un oyente** | **TODO OK** |
| Regresión: `microfono_stream`, `video_v1`, `video_v2_pantalla2`, `agent_live`, `voice_mobile`, `sesion_real`, `cc_login` y todas las pruebas del motor | OK |

Lo que mide el oyente en el E2E (amplitud en el stream):

| Momento | Grave (220 Hz) | Agudo (3 kHz) |
|---|---|---|
| Sin efectos | 0,196 | 0,129 |
| Filtro pasa-bajos en la salida general | 0,212 | **0,002** |
| Filtro apagado | — | 0,129 |

`agent_live_e2e` falló 1 vez en 8 corridas. Los eventos del agente redibujan el panel, y si el botón «Aprobar» se reemplaza
justo en el clic, el clic se pierde (pasaba antes de este cambio). La prueba reintenta el clic **solo si el servidor no
registró la decisión**. Pasó 3/3 después del ajuste.

## 4. Pendiente y límites

- **Prueba de oído:** las pruebas miden niveles y tiempos, pero el gusto del sonido (cuánta reverb, cuánto eco) conviene ajustarlo escuchando.
- Los efectos no se aplican a la voz del micrófono, a propósito.
- Sin agente conectado, los bancos no suenan en este equipo: la consola lo avisa. Los efectos sobre la reproducción local del navegador no están incluidos.
