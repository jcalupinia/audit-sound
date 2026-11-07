# Integración backend — Frontend Pro v0.6 · Entrega P0 (motor real en el navegador)

Esta carpeta documenta la integración del **frontend profesional v0.6** (maqueta que el
dueño entregó) con el **motor de audio real** de AUDIT SOUND. Lo entregado en esta rama:

- `01_DIAGNOSTICO_INTEGRACION.md` — Fase 0 (solo lectura): qué es el v0.6, qué backend
  existe de verdad, las dos rutas de audio, y por qué el esquema `/api/v1/...` del v0.6 no
  existe.
- `02_MAPEO_CONTROLES_API.csv` — los 38 contratos del v0.6 mapeados uno por uno al motor
  real, con estado (EXISTE Y PROBADO / REQUIERE ADAPTADOR / EXISTE INCOMPLETO / NO EXISTE)
  y prioridad P0–P3.

## Qué se cableó en el P0 (decisión del dueño: ruta Navegador/WASM primero)

El v0.6 vivía como **maqueta 100% MOCK** (cada botón solo emitía un evento y guardaba estado
local; el audio salía de un `<audio>` simple, sin EQ/pitch/keylock reales). Se integró
**sin rediseñar el frontend**: mismos colores, misma disposición, mismos componentes HTML.

- `web/pro/v06/` — el frontend v0.6 traído al repo (hereda el `server.js` con COOP/COEP y el
  motor WASM de `web/pro/`).
- `web/pro/v06/src/live_boot.js` — **único módulo ES nuevo**: importa el `AudioBridge` ya
  probado (`web/pro/audio_bridge.js` → `engine_worker.js` → WASM + AudioWorklet +
  SharedArrayBuffer) y lo expone como `window.__ASLive`.
- Costuras mínimas en `web/pro/v06/src/modules/*.js` (y su `app.js` regenerado): un
  interruptor **DEMO ↔ Motor PRO** en la barra de estado. En modo PRO, los controles del
  plato llaman al motor real en vez del `<audio>`:

| Control v0.6 | Llama al motor | Rango mapeado |
|---|---|---|
| PLAY / pausa | `bridge.play(deck,on)` | — |
| CUE | `bridge.cue(deck)` | — |
| Cargar audio | `bridge.load(deck, File, name)` | bytes reales |
| Pitch / tempo | `bridge.rate(deck, v/100)` | 80–120 % → 0.8–1.2 |
| Keylock | `bridge.keylock(deck,on)` | — |
| Beatjump ◀ ▶ | `bridge.beatjump(deck, ±4)` | — |
| Hotcues 1–4 | `bridge.hotcueSet/Jump(deck, slot-1)` | — |
| Loop (beats) | `bridge.loop(deck,on,bars)` | — |
| EQ HI/MID/LOW | `bridge.eq(deck, low,mid,high)` | −12…+12 dB (directo) |
| GAIN | `bridge.gain(deck, v/100)` | 0–200 % → 0–2 lineal |
| VOL (fader) | `bridge.fader(deck, v/100)` | 0–100 → 0–1 |
| Crossfader | `bridge.xfader(x/100)` | 0–100 → 0–1 |
| Master | `bridge.master(v/100)` | 0–100 → 0–1 |

El MockAdapter (DEMO) se conserva como pedía el prompt: por defecto arranca en DEMO y el
usuario activa el motor con un clic (necesario además porque el AudioContext requiere gesto).

También se corrigió `deploy/pro/server.js` para servir el `index.html` de una subcarpeta
(`/v06/` → `/v06/index.html`); antes caía al `index.html` raíz.

## Lo que NO entra en el P0 (ver CSV, son P1–P3)

Video/VJ real, micrófonos/aux al máster, FX DSP profesional (bancos/presets), agente
Qwen/DeepSeek, catálogo Subsonic/Navidrome persistente, IAM/planes/facturación. Siguen en
modo MOCK en el v0.6, claramente etiquetados.

## Cómo probar (local)

```bash
# 1) Motor WASM (si no está compilado): ver e2e/README.md (emcmake + cmake --build)
# 2) Raíz temporal = web/pro + artefactos del motor
tmp=$(mktemp -d); cp -r web/pro/* "$tmp/"; cp wasm/build/audit_engine.js wasm/build/audit_engine.wasm "$tmp/"
ARCHIVE_ENABLED=false WEB_ROOT="$tmp" PORT=8194 node deploy/pro/server.js &
# 3) Abrir http://127.0.0.1:8194/v06/  → entrar como invitado → Consola profesional
#    → "Activar motor PRO" → "+ Cargar audio A" (un .wav/.mp3 real) → PLAY
```

E2E automatizado (Playwright + motor WASM real):

```bash
tmp=$(mktemp -d); cp -r web/pro/* "$tmp/"; cp wasm/build/audit_engine.js wasm/build/audit_engine.wasm "$tmp/"
ARCHIVE_ENABLED=false WEB_ROOT="$tmp" PORT=8194 node deploy/pro/server.js &
BASE=http://127.0.0.1:8194 node e2e/fase_v06_engine_e2e.mjs <carpeta-con-cancionA.wav>
# → 7/7 OK (incluye "Reproducción REAL por el motor: la posición avanza")
```
