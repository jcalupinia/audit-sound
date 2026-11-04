# A1 — Informe de estabilización del motor (AUDIT SOUND)

Rama: `claude/etapa-a` (parte de `claude/bold-edison-3mg4ob`).
Baseline auditado: `a170008` (tip actual de `main`).
Entorno de verificación: contenedor Linux de la sesión (no producción).

> Toda afirmación de este informe se respalda con una ejecución real; las pruebas
> físicas en dispositivos móviles **no** se realizaron y se marcan como pendientes.

## 1. Estado del repositorio respecto al commit auditado `a170008`

- `main` está exactamente en `a170008`; **no hay commits de `main` posteriores** al baseline.
- Los únicos cambios posteriores viven en la rama de trabajo `claude/bold-edison-3mg4ob`
  (PR #23: consola Command Center + login real), sobre la que se basa esta Etapa A.
- Artefactos WASM (`wasm/build/audit_engine.*`) **no están versionados** (`.gitignore`
  los excluye); se compilan en el despliegue (`deploy/pro/Dockerfile`, imagen
  `emscripten/emsdk:6.0.13`) y se copian al sitio.

## 2. Compilación del motor

### 2.1 Motor nativo (servidor) — CMake raíz
- `cmake -S . -B build -DCMAKE_BUILD_TYPE=Release` + `cmake --build build`: **OK**.
- Dependencias de sistema presentes y usadas: `libmp3lame`, `libshout3`, FFmpeg
  (`libavcodec/format/util/swresample`), `libcurl`, `libmicrohttpd`.
- Binarios producidos: `engine_selftest`, `audit_sound_server`, `mp3_verify`,
  `silence_test`, `subsonic_test`, `selector_test`, y el nuevo `control_api_test`.

### 2.2 Motor WASM (navegador) — `wasm/CMakeLists.txt` con `emcc 6.0.13`
- **Defecto encontrado y corregido:** el target `audit_selftest` hacía
  `--preload-file track.wav`, pero `wasm/track.wav` **no está versionado**. Por eso
  `cmake --build wasm/build` (build completo) **fallaba**, aunque el target real
  `audit_engine` sí compilaba. Producción no se veía afectada porque
  `deploy/pro/Dockerfile` compila solo `--target audit_engine`, pero el flujo de
  desarrollo y la autoprueba quedaban rotos.
- **Corrección (commit `4d16e3c`):** `wasm/make_track_fixture.py` sintetiza un WAV
  mínimo y válido (solo stdlib) y `wasm/CMakeLists.txt` lo genera en tiempo de
  configuración si no existe uno versionado. Sin binarios en el repo.
- **Resultado:** `cmake --build wasm/build` ahora termina **COMPLETO OK**
  (`audit_engine` + `audit_selftest`).

### 2.3 Reproducibilidad del artefacto del motor
El `audit_engine.wasm` recompilado desde las fuentes es **byte-idéntico** al que ya
usa el frontend:

```
82c40c122dd3460404c305797a2397b33ff5631c6ca1b74e125dab13224f3e81  (recompilado)
82c40c122dd3460404c305797a2397b33ff5631c6ca1b74e125dab13224f3e81  wasm/build/audit_engine.wasm
```

→ el artefacto del motor es reproducible desde el código y está al día.

## 3. Carga y funcionamiento

- **Nativo:** `engine_selftest` → OK (motor arranca; sink 48 kHz / 2 canales; stop limpio).
- **Selector AutoMix:** `selector_test` → OK (pool 72 pistas; 396/399 transiciones
  armónicamente compatibles = **99,2 %**; 0 repeticiones bajo cooldown).
- **WASM en navegador (consola `/pro/console.html`):** verificado con Playwright
  (Chromium, COOP/COEP): el motor arranca, **carga una pista real y dibuja su forma de
  onda** (deck A, BPM detectado); decks/EQ/crossfader presentes; play del deck operativo.

## 4. Pruebas automatizadas (estado)

| Prueba | Tipo | Estado | En CI |
|---|---|---|---|
| `engine_selftest` | arranque motor + OfflineSink | OK | sí |
| `selector_test` | armonía/tempo/energía/anti-repetición | OK | **añadida** |
| `control_api_test` | seguridad Control API (ver informe A1.3) | 12/12 OK | **añadida** |
| build WASM completo | `audit_engine` + `audit_selftest` | OK | **pendiente** (ver §6) |
| Consola WASM (Playwright) | carga pista + waveform | OK (local) | pendiente |

## 5. Reproducción continua y recuperación ante fallos

- El `audit_sound_server` reintenta la conexión a Icecast hasta que está disponible
  (observado en `deploy/docker-compose.yml`: `engine` depende de `icecast` y reintenta).
- El selector evita repeticiones y mantiene compatibilidad armónica → continuidad del set.
- **Pendiente (A1.4):** una prueba automatizada específica de *reproducción continua
  de larga duración + recuperación ante caída del sink/fuente* (matar Icecast y
  comprobar reanudación). Hoy existe evidencia indirecta (reintento + selftest), no una
  prueba dedicada de failover. Se propone añadir `tools/playback_recovery_test`.

## 6. Hallazgos abiertos / recomendaciones

1. **CI no compila el WASM** (sin `emsdk` en `.github/workflows/ci.yml`): ese build
   nunca estuvo cubierto por CI. Recomendación: añadir un job con
   `mymindstorm/setup-emsdk@v14` (emcc 6.0.13) que ejecute `cmake --build wasm/build`
   completo. No incluido aún por el peso del toolchain; queda como recomendación acotada.
2. **A1.4 failover:** añadir prueba dedicada de reproducción continua + recuperación.
3. **A1.6 móvil:** compatibilidad iOS/Android **no** probada físicamente. La consola PRO
   (WebCodecs/SharedArrayBuffer) requiere Chrome/Edge o Android; iOS Safari no soporta
   el convertidor Opus (ya documentado). La ruta de *escucha* (streaming `<audio
   playsinline>` + Media Session) está pensada para iOS pero **sin verificación física
   en esta sesión**. No se afirma lo que no se probó.

## 7. Veredicto parcial A1 (motor)

- Compilación: **estabilizada** (nativo OK; WASM completo reparado y reproducible).
- Funcionamiento verificado: arranque, sink, selector, carga de pista + waveform.
- Seguridad del Control API: ver `A1_INFORME_SEGURIDAD_CONTROL_API.md` (endurecida).
- Falta para cerrar A1 por completo: prueba de failover (A1.4), WASM en CI, y la
  validación física móvil (A1.6), que es responsabilidad de prueba manual del equipo.
