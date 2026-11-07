# 00 · Diagnóstico y línea base — Agente DJ (Fase 0, solo lectura)

Especificación: AS-AGENT-BE-01 v1.0 · Fecha: 2026-11-07
Repositorio: `jcalupinia/audit-sound` · base inspeccionada: `main` @ `a9cf7b5`
Modo: **solo lectura** — no se modificó código, infraestructura ni producción.

## 1. El agente DJ NO existe (evidencia)

| Comprobación | Resultado |
|---|---|
| `ls services/` | no existe |
| `git ls-files \| grep -iE "dj[-_]?agent\|intent\|model_router\|qwen\|deepseek\|fastapi\|pyproject"` | 0 archivos |
| `git grep -iE "qwen\|deepseek\|fastapi\|llm"` (código) | solo textos de UI del v0.6 y un comentario de `web/pro/console_setai.js:7`, que declara ser **determinista, sin LLM** |
| Lenguajes del repo | C/C++ (motor), JS (web), sin servicio Python |

Conclusión: el servicio se construye **desde cero** (Fase 1+). Lo que hoy se llama "copiloto" en el
v0.6 es el recomendador determinista local (`web/pro/copilot.js`, cableado en el P0.2), no un agente.

## 2. Componentes reales reutilizables

### 2.1 Motor C++17 + AutoMix + Selector (servidor)
- `tools/audit_sound_server.cpp` arranca motor, AutoMix, Selector, Control API e Icecast.
  - `:147-159` analiza **cada pista del catálogo** (`dj_analyze_file` → BPM/tono; `dj_analyze_silence` → energía) y la registra en el `Selector`; `automix_set_next_track(am, Selector::nextTrackCb, …)`.
  - `:173-178` `control_api_start(...)` y `control_api_add_track(title, path)`.
- `engine/automix/automix.h:19-41`: `enable`, `skip`, `set_transition_time`, `set_mode`, `state`, `current_path`, `from_deck`, `set_next_track(cb)`.
- `engine/selector/selector.h:25`: `addTrack(path, bpm, key, energy)`.

### 2.2 Control API HTTP (libmicrohttpd) — `engine/api/control_api.cpp`
| Ruta | Línea | Qué hace |
|---|---|---|
| `POST /api/login` | :294 | login por cuerpo POST, token propio por dispositivo |
| `POST /api/logout` | :337 | cierra sesión |
| `POST /api/control/{take,request,approve,deny,release}` | :347-385 | **un solo dispositivo controlador** a la vez (handoff) |
| `GET /api/tracks` | :392 | catálogo — **solo `{i, title}`**, sin BPM/tono/energía/duración |
| `GET /api/status` | :402 | `mode`, `xfader`, `state` AutoMix, `transition`, `mixmode`, controlador, `decks[{title,loaded,playing,pos,dur,bpm,key}]` |
| `POST /api/command` | :420 | acciones: `set_mode_dj` (manual/auto), `deck_load` (por índice), `deck_play`, `deck_pause`, `deck_cue`, `deck_set_cue`, `xfader`, `eq`, `filter`, `gain`, `rate`, `skip`, `set_transition`, `set_mode` |

- Token **solo por `Authorization: Bearer`** (`control_api.cpp:148-151`, S‑01 ya resuelto).
- Respuesta de `/api/command`: `{"ok":true}` síncrono; la verdad del estado se lee en `/api/status`.
- Sin TLS en proceso (va detrás del proxy); sin idempotencia ni versión de estado.

### 2.3 Streaming y catálogo
- Icecast: `engine/sinks/icecast_byte_sink.hpp` + `deploy/icecast/` (reconexión S1 verificada en `scripts/verificar_s1_reconexion.sh`).
- Catálogo: `engine/catalog/subsonic.{h,cpp}` (Navidrome) o carpeta `/music`, `/cc-music` (CC) o DEMO (`deploy/engine/entrypoint.sh`).
- Despliegue de referencia: `deploy/docker-compose.yml` → servicios `icecast`, `engine` (Control API en `:8787`, interno), `web`.

### 2.4 Frontend v0.6 (en `main` desde #47/#48/#49)
- `web/pro/v06/`: 20 pantallas, 291 controles inventariados, 38 contratos **propuestos**.
- 39 controles relacionados con el agente → ver `04_MAPEO_CONTROLES_FRONTEND_V06.csv`
  (25 sin backend, 12 de cambio de modo con el motor parcial, 2 locales).
  Los botones *Aprobar/Rechazar* no figuran en el registro porque solo se dibujan cuando hay propuestas.
- **Importante:** el cableado P0–P0.3 usa el motor **WASM del navegador**. Eso **no cumple P‑03**
  (cerrar la pestaña detiene el audio). El agente debe gobernar el **motor del servidor** (Control API + Icecast).

### 2.5 Infraestructura de IA ya resuelta en el Audi Brain Runner
Repositorio `jcalupinia/auditbrain-python-runner`, `backend/app/chat/providers.py`:
- Modelo **local**: gateway **LiteLLM compatible con OpenAI** — `LOCAL_LLM_BASE_URL` (termina en `/v1`),
  `LOCAL_LLM_API_KEY` (opcional), `LOCAL_LLM_MODEL` (default lógico `auditia-rutina`); el comentario de
  `backend/app/aud/niif/ciclo/extraccion_ia.py:56` indica que sirve **Qwen3 / gpt-oss**.
- **DeepSeek**: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default `deepseek-flash`), con `deepseek-v4-pro` para razonamiento.
- `backend/app/chat/ruteo.py`: ruteo heurístico de 2 niveles (consulta / razonamiento), sin llamada LLM extra, con cadena de respaldo.
- Tests existentes: `tests/test_providers_deepseek.py`, `tests/test_providers_local_ventana.py`, `tests/test_chat_ruteo.py`.

→ El agente DJ **reutiliza el protocolo y las convenciones** (mismas variables de entorno), no el proceso del runner.

## 3. Brechas que bloquean un agente real

| # | Brecha | Impacto | Propuesta (mínima) | Fase |
|---|---|---|---|---|
| B1 | `/api/tracks` no expone BPM/tono/energía/duración | el agente no puede planificar con datos reales | ampliar el JSON con los metadatos que el servidor **ya calcula** (`:147-159`) | F2 |
| B2 | No hay cola inyectable: el `Selector` decide solo | un plan del agente no llega al AutoMix | acción `queue_set`/`queue_append`: `nextTrackCb` consume primero la cola del agente y, si está vacía, cae al `Selector` (continuidad garantizada) | F2 |
| B3 | Modo HÍBRIDO no existe en el motor | — | lo gestiona el agente (motor en `auto` + propuestas con aprobación) | F1 |
| B4 | Un solo controlador por token | el agente y el DJ humano compiten | cuenta de servicio del agente + regla de propiedad por modo (ADR‑005) | F2 |
| B5 | `/api/command` sin idempotencia ni versión | doble clic / reintento = doble acción | idempotencia y `expected_version` en el servicio del agente; el motor recibe comandos ya deduplicados | F1 |
| B6 | Sin hotcues/loop/keylock/energía en la Control API | herramientas limitadas | fuera de alcance del agente v1; el agente usa cola, transición, skip, modo, EQ/xfader | — |
| B7 | Despliegue del motor servidor en Coolify | — | **NO VERIFICADO** (conector de Coolify sin autorizar en esta sesión) | F7 |

## 4. Lo que no se pudo verificar (NO VERIFICADO)

- Modelo Qwen exacto, runtime detrás de LiteLLM, contexto, latencia y **RAM libre real de los 16 GB**:
  `LOCAL_LLM_*` no está en este contenedor.
- DeepSeek: clave, cuotas y facturación (la clave vive en el entorno del runner, no aquí).
- Si el servicio `engine` (Control API + Icecast) corre hoy en Coolify; producción conocida: `sound.audit-ia.ec` (web PRO).
- Dispositivos iOS/Android físicos.

## 5. Herramientas disponibles para construir
Python 3.12.3 y 3.13, FastAPI 0.162, Pydantic 2.13, pip, Docker y `psql` presentes. El motor C++
compila localmente (usado en sesiones previas para `soak_autodj.sh`), lo que permite probar el
adaptador real **sin tocar producción**.
