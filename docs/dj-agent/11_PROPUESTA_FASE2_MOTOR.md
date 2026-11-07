# 11 · Fase 2 — extensiones mínimas del motor C++ (APROBADA e IMPLEMENTADA)

> **Estado:** aprobada por el dueño («Arranca la Fase 2») e **implementada** en la rama `claude/dj-agent-fase2`.
> El §8 resume lo implementado y lo que cambió respecto de esta propuesta al probar con el binario real.

## 1. Principios

- **Cambios aditivos** y retrocompatibles: los clientes actuales (consola web, app) siguen funcionando igual.
- **No se cambia el algoritmo del Selector/AutoMix.** Se antepone una cola al callback de "siguiente pista";
  cuando la cola está vacía se llama al `Selector::nextTrackCb` exactamente como hoy.
- **Nada bloquea el hilo de audio.** La cola vive en el hilo de AutoMix y en el de la Control API, protegida
  por un `std::mutex` con operaciones O(1); el callback de audio no se toca.

## 2. B1 — Metadatos en `GET /api/tracks`

El servidor ya los calcula al arrancar (`tools/audit_sound_server.cpp:147-159`: `dj_analyze_file` →
BPM/tonalidad, `dj_analyze_silence` → energía). Propuesta:

```json
{"metadata": true,
 "tracks": [{"i": 0, "title": "…", "bpm": 124.0, "key": 7, "energy": 0.62, "duration": 183.4}]}
```

- `key`: codificación del motor (0–11 mayor, 12–23 menor, −1 desconocida).
- Nueva función `control_api_add_track_meta(api, title, path, bpm, key, energy, duration)`; la actual
  `control_api_add_track` se mantiene (metadatos desconocidos → `bpm:0, key:-1, energy:null`).
- Lado agente: `ControlApiAdapter.tracks()` leerá los campos y declarará la capacidad `metadata`.

## 3. B2 — Cola administrada por el agente

Nuevas acciones de `POST /api/command` (mismo mecanismo: parámetros en la query, Bearer, solo el controlador):

| Acción | Parámetros | Efecto | Respuesta |
|---|---|---|---|
| `queue_set` | `tracks=3,7,12` (≤ 50) | reemplaza la cola del agente | `{"ok":true,"queue":[3,7,12]}` · 400 `unknown_track` |
| `queue_append` | `tracks=…` | añade al final | cola resultante |
| `queue_remove` | `track=7` | cancela una pista pendiente | cola resultante |
| `queue_clear` | — | vacía la cola (AutoMix vuelve a su selector) | `{"ok":true,"queue":[]}` |

Nuevo `GET /api/queue` y campos adicionales en `/api/status` para supervisar la próxima transición:

```json
{"queue": [7, 12], "next": {"source": "agent", "i": 7, "title": "…"}}
```

**Regla de selección** (en el hilo de AutoMix, antes de cargar el plato entrante):
1. Si la cola del agente tiene elementos → toma el primero; si el archivo no existe o falla la carga, lo descarta,
   registra el evento y prueba el siguiente.
2. Si la cola está vacía → `Selector::nextTrackCb` (algoritmo actual, sin cambios).

**Cancelación segura:** quitar o vaciar la cola nunca interrumpe una transición en curso; si la pista ya está
entrando en el plato, la cancelación solo afecta a lo que viene después (sin cortes de audio).

## 4. Hallazgo a resolver junto con la Fase 2

`set_mode_dj` con `manual` fija el crossfader en 0,5 (`engine/api/control_api.cpp`, acción `set_mode_dj`). Con la
curva del motor el plato al aire sigue a ganancia unitaria, pero si el otro plato estuviera sonando se oiría de golpe.
Propuesta: no tocar el crossfader si hay un plato sonando. El simulador reproduce el comportamiento actual y la prueba
`test_modo_manual_del_motor_no_detiene_el_plato_al_aire` lo documenta.

## 5. Cambios en el agente (Fase 2)

- `ControlApiAdapter`: capacidades `metadata`/`queue` cuando el motor las anuncie; `verify_effect` para la cola
  (`state_verified` comparando `/api/queue`); prueba de integración contra el **binario real**.
- Cuenta de servicio del agente en la Control API (`DJ_AGENT_ENGINE_USER/PASS`) y política de control (ADR-005).

## 6. Plan de pruebas de la Fase 2 (entorno aislado)

1. Compilar `audit_sound_server` localmente y arrancarlo con la biblioteca CC o DEMO (sin producción).
2. Pruebas de contrato del adaptador contra el binario real (las de la Fase 1, sin transporte simulado).
3. 30 cambios de modo con el motor real: sin reinicio, mismo tema al aire, stream continuo (oyente Icecast).
4. Cola con prioridad sobre el selector y vuelta automática al agotarse; cancelación sin cortes.
5. Agente detenido a mitad de sesión → el audio continúa (reutilizar `scripts/soak_autodj.sh`).
6. Soak mínimo de 4 h con el agente en AUTOMÁTICO: silencios, pistas perdidas, cola vacía, memoria.

## 7. Estimación orientativa

C++ (B1 + B2 + estado) 1,5–2 días · adaptador e integración 1 día · pruebas y soak 1–1,5 días (más las 4 h de soak).

## 8. Implementado (Fase 2)

| Elemento | Dónde | Prueba |
|---|---|---|
| B1 · `/api/tracks` con `bpm`, `key`, `energy`, `duration` y `metadata:true/false` (aditivo) | `engine/api/control_api.cpp` (`control_api_add_track_meta`), `tools/audit_sound_server.cpp` (guarda el análisis existente + `dj_file_duration`) | `control_api_test` (B1 ×4) · real: los BPM analizados coinciden con los generados |
| B2 · `queue_set/append/remove/clear` (≤ 50, validación de índices), `GET /api/queue`, `queue`/`next_source` en `/api/status` | `control_api.cpp` | `control_api_test` (B2 ×15) |
| B2 · la cola tiene prioridad y, vacía, decide el Selector **sin cambios** | `audit_sound_server.cpp::nextChained` (envoltorio del callback; `Selector::nextTrackCb` intacto) | `selector_test` OK · real: el AutoMix toma la pista encolada y luego vuelve al Selector |
| Cerrojo propio de la cola (`queueMu`), sin depender del de la API HTTP | `control_api.cpp` | sin bloqueos en las pruebas reales |
| Pista encolada sin archivo → se descarta y se prueba la siguiente | `control_api_next_queued` | `control_api_test` |
| `set_mode_dj`: el crossfader solo se centra si no suena nada | `control_api.cpp` | real: 30 cambios de modo sin corte |

### Cambios respecto de la propuesta, descubiertos con el binario real

1. **Bug previo del motor corregido (grave):** al pasar a MANUAL, `set_mode_dj` decidía si un plato estaba vacío
   mirando `deckTitle`, que el AutoMix nunca rellena, y **recargaba la pista 0 encima del plato que sonaba**,
   cortando el audio. Ahora usa `dj_loaded()` y conserva el título de lo que deja sonando el AutoMix. El motor
   simulado de la Fase 1 no lo reproducía (modelaba "plato vacío" de otra forma) y se ajustó al C++ corregido.
2. **Latencia de la cola:** el AutoMix precarga la siguiente pista apenas empieza una. La cola del agente entra en
   la **siguiente carga libre**, es decir, como mucho una pista después de la ya precargada. No se cambió el
   AutoMix; el agente planifica con esa demora.
3. **Control tras un reinicio del agente:** el motor da el control al primer dispositivo y mantiene viva su sesión
   2 h, así que un agente reiniciado con un login nuevo quedaba sin control. Solución en el agente, sin tocar el C++:
   token de la sesión persistido en su base (reanuda la misma sesión tras una caída), `logout` al apagarse
   (libera el control) y un único reintento de `control/take` si un comando recibe 409 (solo prospera si el
   control está libre; nunca se arrebata).
4. **El Selector no conoce las pistas que encola el agente** (no hay API para informarle sin cambiar su algoritmo):
   el planificador del agente evita sus propias repeticiones; queda como limitación documentada.
