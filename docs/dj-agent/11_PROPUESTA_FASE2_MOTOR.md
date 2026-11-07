# 11 · Propuesta técnica Fase 2 — extensiones mínimas del motor C++ (PARA APROBACIÓN)

> **No se ha modificado el motor C++.** Este documento propone el contrato; su implementación requiere tu
> aprobación expresa. El agente (Fase 1) ya está preparado para él: capacidades `metadata` y `queue` del
> `EngineAdapter`, simuladas en `FakeEngine` y probadas.

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
