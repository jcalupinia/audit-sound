# Auditoría empírica del estado actual de la consola — AUDIT SOUND

**Fecha:** 2026-11-05
**Qué se auditó:** `web/pro/console.html` (la página que el dueño usa en producción,
`https://sound.audit-ia.ec/console.html`), botón por botón, con un **navegador real
(Playwright + Chromium)**, incluida la prueba de **mezclar dos canciones**.
**Prueba:** `e2e/console_music_e2e.mjs` (ver «Cómo reproducirla»).

> Esto corrige una afirmación anterior demasiado optimista: la etiqueta «🟡» del inventario
> significaba «hay código en un módulo», **NO** «funciona en tu consola». Esta auditoría mide lo
> que **de verdad** funciona hoy en `console.html`.

## Resultado (10/10 verificaciones, con navegador real)

### ✅ Lo que SÍ funciona hoy en `console.html`
| Verificación | Evidencia medida |
|---|---|
| La imagen de la consola carga | `landing_consola.webp` visible |
| Importar carga **2 canciones** (A y B) | A y B con fuente cargada |
| **Las DOS canciones suenan a la vez (MEZCLA)** | A avanza (t≈0.59 s) y B avanza (t≈0.31 s) simultáneamente |
| **Crossfader mezcla A↔B** | izquierda A=0.90/B=0.00 · derecha A=0.00/B=0.90 |
| **Master** sube/baja ambos | alto A=1.00 · bajo A=0.30 |
| **CUE** detiene y rebobina | A pausado=true, t=0 |
| Icono usuario → cerrar sesión | confirm de logout mostrado |
| Sin errores JS en la página | ninguno |

**Conclusión positiva:** sí, **dos canciones se cargan y se mezclan de verdad** (crossfader + master
verificados midiendo los volúmenes reales). Los 8 controles de la etapa 1 funcionan.

### ❌ Lo que NO funciona (no existe en el DOM: es solo la imagen)
Enumerando TODOS los controles interactivos de `console.html`, existen **exactamente estos 11**:
`importar, playA, playB, cueA, cueB, xfader, master, hotUser, fileIn, audioA, audioB`.

Por lo tanto, **no hay ningún elemento clicable** para:
- EQ **HI/MID/LOW**, **SYNC**, **pitch ±8%**, **keylock**, **Loops** (IN/OUT/beats), **Hotcues 1-4**, **beatjump** (`< >`), jog wheel.
- **Buscador** y filtros (Tipo/Género/BPM), ítems de la **biblioteca**, categorías.
- **IA Copiloto** (sugerencias/transiciones/contenido), **modos** DJ (Manual/Híbrido/Automático), Vista Sencillo/Profesional.
- **Micrófono/Talkover**, medidores VU, **Video/VJ**, **Preview→Programa**, **Enviar a vivo**, **Salidas de video**, **Generar con IA**.
- Navegación: **Biblioteca / Playlists / Eventos / Generador IA / Configuración**.

Todo eso está **dibujado en la imagen** pero no tiene función. Hacer clic sobre esas zonas no hace nada.

## Lo que NO se pudo auditar aquí (limitación honesta)
- **`mixer.html` (motor real WASM+AudioWorklet):** no se pudo ejecutar en este entorno porque **`emcc`
  (Emscripten) no está instalado** y no hay artefactos WASM compilados en el repo. El motor C++ sí
  tiene autopruebas en CI (`control_api_test`, `playback_recovery_test`, selector), pero el
  **extremo-a-extremo de `mixer.html` en un navegador NO está verificado**. Queda como prueba
  pendiente (construir WASM y repetir esta auditoría sobre el motor real).

## Veredicto
- **¿Funcionan todos los botones del frontend hoy?** **No.** Funcionan los **8 controles de música de
  la etapa 1** (y la mezcla de dos canciones **sí** opera). El resto de botones de la imagen **no
  tienen función todavía**.
- **¿Está «hecho»?** La lógica de música/DJ existe en los módulos (`search.js`, `copilot.js`, motor),
  pero **no está cableada a `console.html`**, así que **en tu consola no funciona aún**. Es trabajo
  real de la **Etapa B** (ver `PLAN_ETAPA_B.md`), no «cableado trivial».
- Esta misma prueba (`e2e/console_music_e2e.mjs`) es el **criterio de “verde”**: a medida que la
  Etapa B cablee EQ, SYNC, loops, hotcues, buscador y copiloto, se añaden verificaciones y deben
  pasar **con navegador real** antes de declarar nada funcional.

## Cómo reproducirla
```bash
# 1) servir la consola (genera config.js y cabeceras COOP/COEP)
WEB_ROOT=web/pro PORT=8192 node deploy/pro/server.js &
# 2) dos audios de prueba
ffmpeg -f lavfi -i "sine=frequency=440:duration=6" -ac 2 -ar 44100 /tmp/cancionA.wav -y
ffmpeg -f lavfi -i "sine=frequency=220:duration=6" -ac 2 -ar 44100 /tmp/cancionB.wav -y
# 3) la prueba (requiere playwright + chromium)
node e2e/console_music_e2e.mjs /tmp   # usa cancionA.wav y cancionB.wav de esa carpeta
```
Debe imprimir `RESULTADO: 10/10 verificaciones OK`.
