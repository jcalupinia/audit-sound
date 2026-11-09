# Evidencia · Bloque 2 de video

## V1b · Videoclips con sonido y V3 · Fotos, presentaciones y cues (2026-11-09)

> **Estado:** en revisión, en la rama `claude/videoclips-presentaciones`. Funciona en la consola del DJ (navegador). El video
> se ve en este equipo y en la pantalla 2; no se transmite por internet (eso es V5).

| Elemento | Estado | Evidencia |
|---|---|---|
| **Fotos** en los decks de video: se mezclan, con transiciones y efectos, igual que un video | **REAL** | E2E: la foto verde se ve en la mezcla |
| **Presentaciones desde PDF**: el PDF se convierte en diapositivas dentro del navegador (pdf.js 6.4.299 incluido en `web/pro/vendor/pdfjs`, Apache-2.0, sin internet); también varias fotos a la vez forman una presentación | **REAL** | E2E: PDF de 2 páginas → 2 diapositivas (roja y azul) |
| ◀ ▶ y avance automático (5/10/20/30 s); al final vuelve a la primera | **REAL** | E2E píxel a píxel |
| Las presentaciones se guardan: siguen tras recargar; la biblioteca las muestra («PRESENTACIÓN · 2») y al quitarlas se borran | **REAL** | E2E |
| **Videoclips con sonido (V1b)**: el mismo archivo va al deck de audio (sonido) y al de video (imagen); la imagen sigue al audio en PLAY/pausa, posición (saltos, CUE) y velocidad (pitch) | **REAL** | E2E: diferencia imagen-sonido 0,05 s; pitch 110 % → imagen ×1,1; salto a 4 s → la imagen salta |
| **Crossfader compartido**: el crossfader de audio mueve también la mezcla de video (se puede desvincular) | **REAL** | E2E |
| **Cues de eventos reales**: cada cue elige un video, foto o presentación; «Ejecutar» lo carga en el deck que no está al aire y lo pasa a programa con la transición elegida; con «Automático: SÍ» se ejecuta solo a su hora (con la pestaña abierta) | **REAL** | E2E: cue manual (presentación al aire) y automático (foto a su hora) |
| Videoclips con sonido en modo «motor profesional» (WASM) o en el stream del servidor | **NO INCLUIDO** | El sonido del videoclip usa el audio del navegador; la consola lo avisa |
| Formato .mp4 (H.264) | **NO VERIFICADO EN CI** | Chromium de Playwright no trae H.264; las pruebas usan WebM. Chrome/Edge reproducen .mp4 |

Pruebas: `video_v3_e2e.mjs` **TODO OK (2 corridas)**, agregada al CI. `video_v1_e2e` ajustada (las opciones de la
biblioteca llevan el tipo delante: ▷ video · ▣ foto · ▤ presentación). Regresión: `video_v2_pantalla2`, `agent_live`,
`voice_mobile`, `sesion_real`, `cc_login`, `microfono_stream` y `efectos_stream`: OK.


## V2 · Pantalla 2 (proyector) y programa con transición (2026-11-09)

> **Estado:** en revisión, en la rama `claude/video-v2-pantalla2`, apilada sobre la de micrófonos. Funciona en el
> mismo equipo del DJ: la pantalla 2 es una ventana que se lleva al proyector. No hay transmisión por internet (eso es V5).

| Elemento | Estado | Evidencia |
|---|---|---|
| Botón «Abrir pantalla 2»: ventana «Programa» sin controles, que muestra en vivo la salida Programa (1280×720) | **REAL** | E2E: se lee el video **de la ventana** (lo que ve el público) |
| Si el navegador lo permite (Window Management API), la ventana se abre directamente en la pantalla secundaria; si no, se arrastra al proyector | **REAL** (código) | Prueba física pendiente con dos pantallas |
| Doble clic o tecla F en la ventana: pantalla completa | **REAL** (código) | Prueba física pendiente |
| «Enviar a programa» y «Detener» con la transición elegida: Desvanecer (0,9 s, pasa por cuadros intermedios), Barrido (de izquierda a derecha) o Corte (inmediato) | **REAL** | E2E píxel a píxel en la pantalla 2 |
| Sin programa, el público ve negro (antes salía el texto «PROGRAMA DETENIDO» en la salida) | **REAL** | E2E |
| **Pánico**: logo fijo al instante (el logo cargado o «AUDIT SOUND»); la mezcla no afecta lo que se ve hasta quitarlo | **REAL** | E2E |
| La consola sabe si la pantalla 2 está abierta y detecta cuando se cierra | **REAL** | E2E |
| Selector «Salida → Pantalla 2 (proyector)», antes «fase V2» | **REAL** | código |

Pruebas:
- `video_v2_pantalla2_e2e.mjs`: **TODO OK, 2 corridas**. Agregada al CI.
- `video_v1_e2e.mjs`: OK. Se ajustó la espera de «Detener» porque ahora usa la transición.
- Regresión: `agent_live`, `voice_mobile`, `sesion_real`, `cc_login` y `microfono_stream`: OK.


## V1 · Compositor de video por GPU (2026-11-08)

> **Estado:** en revisión, en la rama `claude/video-v1`. No hay despliegue ni cambios en producción. La mezcla se hace en el
> navegador del DJ y **no se transmite**: la salida a proyector es V2 y la transmisión por internet es V5.

### Qué se entregó

| Elemento | Estado | Evidencia |
|---|---|---|
| Mezcla A/B por GPU (WebGL), 1280×720, con recorte «cover» (no deforma videos de otra proporción) | **REAL** | E2E: crossfader en A → rojo, en B → azul, 50 % → 127,0,127 |
| Transiciones Desvanecer, Corte y **Barrido** (antes «backend pendiente») | **REAL** | E2E píxel a píxel |
| Efectos Brillo, Desenfoque y Glitch con intensidad | **REAL** | E2E (brillo mínimo → 76,0,0; desenfoque; glitch dibujando) |
| Texto de superposición (franja inferior) y logo (imagen de la biblioteca, arriba a la derecha) | **REAL** | E2E (franja oscura; logo amarillo detectado) |
| Crossfader en vivo mientras se arrastra, sin redibujar la página | **REAL** | código (`input` → estado) |
| **La reproducción no se reinicia al tocar controles ni al cambiar de pantalla**. Antes, cada redibujo recreaba los `<video>` | **REAL** | E2E |
| «Enviar a programa» copia la mezcla a la salida; «Detener» la deja en negro | **REAL** | E2E |
| La consola muestra la mezcla real en «Previsualización» y «Programa» (antes carteles fijos) | **REAL** | E2E |
| **Biblioteca de videos e imágenes que se guarda** (IndexedDB `auditsound-video`): sigue tras recargar y se puede borrar | **REAL** | E2E (recarga, elegir de la biblioteca, quitar) |
| Texto, logo, efecto, transición y crossfader se recuerdan entre sesiones | **REAL** | E2E (texto tras recargar) |
| Respaldo sin GPU (Canvas 2D) con fundido, corte, barrido, brillo y desenfoque | **REAL** | E2E con WebGL desactivado |
| Medidor de cuadros por segundo en pantalla | **REAL** | E2E: 29–33 cuadros/s en Chromium sin GPU física (SwiftShader) |
| Glitch en el respaldo 2D | **NO IMPLEMENTADO** | solo en GPU |
| Rendimiento en el computador real del DJ, con videos HD | **NO VERIFICADO** | requiere prueba física |
| Videos H.264 (.mp4) | **NO VERIFICADO EN CI** | el Chromium de Playwright no trae H.264; las pruebas usan WebM. Chrome y Edge reproducen .mp4 |

### Archivos
- `web/pro/v06/src/modules/07-video-compositor.js` (nuevo): compositor, estacionamiento de reproductores y
  lienzos fuera del redibujo, biblioteca persistente y ayudas de prueba `window.__ASVJ`.
- `02-screens.js` / `01-core-console.js`: pantallas de video y consola con huecos `data-vslot`.
- `03-actions-audio-video.js` / `04-events-forms.js`: controles conectados al compositor.
- `web/pro/v06/tests/video_v1_e2e.mjs` + `video_rojo.webm`, `video_azul.webm`, `logo_prueba.png`.
- CI: job nuevo «Compositor de video V1 (Chromium real)».

### Pruebas ejecutadas
- `node web/pro/v06/tests/video_v1_e2e.mjs`: **TODO OK en varias corridas** (33 comprobaciones, incluido el
  respaldo 2D y el teléfono sin desbordes).
- Regresión de la consola: `agent_live_e2e`, `voice_mobile_e2e` y `cc_login_e2e` TODO OK; las 20 pantallas en escritorio y teléfono
  sin errores (se corrigió un desborde del deslizador de intensidad en 390 px); `commandcenter_test` 14/14,
  `search_test` 18/18, `proxy_test` 13/13, `agent_proxy_test` TODO OK.

### Siguiente
**V1b · Videoclips**: el audio del video pasa por el motor y un solo crossfader mezcla imagen y sonido.
