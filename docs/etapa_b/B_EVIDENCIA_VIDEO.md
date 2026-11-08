# Evidencia · Bloque 2 de video

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
