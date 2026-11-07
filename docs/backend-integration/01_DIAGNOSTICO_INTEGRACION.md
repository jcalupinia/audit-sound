# FASE 0 — Diagnóstico de integración (solo lectura)
**AUDIT SOUND · Frontend Pro v0.6 ↔ backend real**

- Repo real: `jcalupinia/audit-sound` · rama de trabajo `claude/consola-botones-reales`
- SHA HEAD inspeccionado: `dae50128de70913288d8a593dcc83f728d8c33aa`
- Fecha: 2026-11-07
- Modo: **solo lectura** (no se modificó código ni se desplegó nada)

---

## 1. Qué me entregaste (el v0.6)

El `.zip` y el HTML de 1.6 MB son **la misma app v0.6**: el HTML grande es el **build de un
solo archivo** (`dist`); la fuente editable es modular (`src/app.js` + `src/styles.css` +
`index.html`, se arma con `scripts/build.py`).

Evidencia (`src/app.js`):
- Toda orden pasa por `command(name,payload,status='MOCK')` → emite
  `window.dispatchEvent(new CustomEvent('auditsound:command',{detail:{name,payload,correlationId,mode:'mock',contract}}))` (línea 32).
- `window.AuditSoundQA...getState:()=>({... backendConnected:false})` (línea 218).
- Estado en `localStorage` (`save()`, línea 30). Pistas = `DEMO_TRACKS`.

**Conclusión:** el v0.6 es una **maqueta navegable 100% MOCK**. No reproduce audio real por el
motor, no habla con ningún servicio: dibuja estado local y registra "comandos". Coincide con su
propia auditoría QA (`APROBADO solo como DEMO cableable; NO para producción`).

## 2. Qué asume el v0.6 vs. qué existe de verdad

Los 38 contratos (`contracts/event-registry.json`, `contracts/types.ts`) apuntan a un backend
REST+WebSocket en **`/api/v1/...`** y todos están marcados **`"status":"PROPUESTO"`, `"mock":true`**.

**Ese esquema `/api/v1/...` NO existe en el repo.** El backend real tiene **dos rutas de audio**,
ninguna con esa forma:

### Ruta A — Navegador / WASM (`web/pro/`) — la que ya reproduce de verdad
- `web/pro/audio_bridge.js` → `class AudioBridge`: motor WASM en la página vía
  `engine_worker.js` (Worker) + `mixer_worklet.js` (AudioWorklet) + `ring.js` (SharedArrayBuffer).
- **No hay REST**: la consola actual (`console.html` + `console_*.js`) llama **métodos JS directos**
  de `AudioBridge`.
- `deploy/pro/server.js` (258 líneas) sirve **estáticos** + solo 4 rutas, todas de *búsqueda de
  música*: `/api/openmusic/search`, `/api/openmusic/audio`, `/api/archive/search`,
  `/api/archive/audio`. **No expone transporte, mezcla, FX ni video.**

Métodos reales ya implementados en `AudioBridge` (audio_bridge.js:66-198):
`load · play(deck,on) · seek · cue · jumpCue · gain · eq(low,mid,high) · filter · fader ·
rate · keylock · master · xfader · hotcueSet/Jump/Clear · loop(on,bars) · beatjump ·
requestWaveform · analyze/analyzeAwait · autoAdd · autoTransition · autoSkip · autoEnable ·
stop · fxEcho/fxEchoTime/fxReverb/fxFilter · recordStart/recordStop` + callbacks
`onStatus/onLoaded/onError`.

### Ruta B — Servidor nativo C++ (`engine/`) — la que da streaming 24/7
- `engine/api/control_api.cpp`: Control API REST real (libmicrohttpd) con **otro esquema**:
  `POST /api/login` · `POST /api/logout` · `POST /api/control/{take,request,approve,deny,release}` ·
  `GET /api/tracks` · `GET /api/status` · `POST /api/command`.
- `engine/sinks/icecast_byte_sink.hpp` → MP3 → **Icecast** (`deploy/icecast/`): el audio sale del
  servidor y **sigue aunque se cierre el navegador**.
- Motor AutoMix real en `engine/automix/` (y su gemelo WASM exportado como `dj_auto_*`).

## 3. Lógica de IA / búsqueda ya existente (no es Qwen/DeepSeek, pero es real)
- `web/pro/console_copilot.js` + `copilot.js`: recomendador **Camelot + BPM + energía** (puro, local, sin LLM).
- `web/pro/console_autodj.js`: DJ automático sobre el **AutoMix real**.
- `web/pro/console_setai.js`: generador de sets conversacional.
- `web/pro/search.js` (+ `openmusic.js`, `archive.js`, `subsonic.js`): búsqueda de música libre.
- `web/pro/library.js`: biblioteca en **IndexedDB** con BPM/key/energía.

**Qwen local y DeepSeek API: no están conectados** (ni en v0.6 ni en el backend). Lo que hay es
un copiloto determinista local real.

## 4. Autenticación / portal
- `web/pro/commandcenter.js` + `login.html` + `deploy/seed_app_accounts.py`: portal con cuentas.
- Control API nativa: `/api/login` por cuerpo POST, token no en URL (S-01).
- **No hay** IAM multi-empresa, planes, licencias ni facturación reales (Etapa 5 del prompt).

## 5. Veredicto de la Fase 0
El v0.6 **no se "reconecta" a un backend `/api/v1`** porque ese backend no existe. La integración
real es **reemplazar el despachador MOCK del v0.6 por un `LiveAdapter`** que:
- para **tocar en el navegador (P0 DJ)** → llame directo a `AudioBridge` (Ruta A), que ya está
  probada;
- para **streaming 24/7 servidor** → hable con la Control API nativa `/api/command`+`/api/status` (Ruta B).

Todo lo demás (video/VJ real, mics al máster, FX DSP profesional, Qwen/DeepSeek, Subsonic
persistente, IAM/SaaS/facturación) son **brechas** de distinto tamaño (ver 03_GAP_Y_PLAN.md).
