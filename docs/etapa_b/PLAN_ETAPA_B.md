# Plan Etapa B — Dejar la consola en verde: primero Música/Sonido, luego Video

**Fecha:** 2026-11-05
**Objetivo:** cablear la consola aprobada (`web/pro/console.html`, imagen `landing_consola.webp`)
a la funcionalidad que **ya existe** en el backend, dejándola en verde **por fases**. Primero toda
la parte de **música / sonido / consola DJ** (🟡 del inventario) y después la parte **audiovisual**
(🔴, desarrollo nuevo).

**Principios (decisión del dueño):**
- **No rediseñar la consola ni tocar la identidad visual aprobada.** Se trabaja con controles
  transparentes **encima de la imagen** (mismo patrón que la etapa 1).
- **No sustituir funciones reales por controles decorativos** (regla A4.4): cada control que se
  active debe mover el audio de verdad.
- **Verificación empírica antes de declarar verde** (regla suprema del proyecto): cada fase define
  su criterio de aceptación y su prueba.
- **Sin desplegar ni mergear sin autorización.** Una rama y un PR por fase.

Referencia del inventario: `INVENTARIO_FRONTEND_VS_BACKEND.md` (mismo directorio).

---

## BLOQUE 1 — MÚSICA / SONIDO / CONSOLA (cablear lo que ya existe)

### Fase 0 — Cimiento: motor real detrás de la imagen
**Qué:** reemplazar en `console.html` el reproductor HTML5 `<audio>` (etapa 1) por el **motor WASM +
AudioWorklet** (`audio_bridge.js` + `engine_worker.js`), manteniendo funcionando los controles que
ya hay (Importar, Play/Cue A-B, crossfader, master). Es prerrequisito de todo lo demás (EQ, SYNC,
loops, hotcues y waveform solo existen en el motor real).
**Archivos:** `web/pro/console.html` (+ un controlador nuevo, p. ej. `console_overlay.js`, que
reutilice la lógica de `console.js`/`mixer.html`).
**Criterio verde:** cargar 2 pistas y reproducir/mezclar con el motor WASM (no HTML5); COOP/COEP y
`.wasm` sirviéndose bien; sin regresión de la etapa 1.
**Prueba:** carga/reproducción en el navegador; `proxy_test.mjs` intacto.

### Fase 1 — Carga, biblioteca y buscador
**Qué:** cablear la barra «Buscar en la biblioteca» + filtros Tipo/Género/BPM al **buscador
unificado** (`search.js`) sobre las 4 fuentes (Jamendo, Internet Archive, Navidrome, biblioteca
local); cargar un resultado/ítem a **Deck A o B**; biblioteca **persistente** (`library.js`).
**Archivos:** `console.html`, controlador overlay, `search.js`, `library.js`, `subsonic.js`,
`openmusic.js`, `archive.js`.
**Criterio verde:** buscar en las 4 fuentes con respeto de licencia por pista (mezclar/previsualizar),
cargar a A y B, y que las pistas persistan al recargar.
**Prueba:** `web/pro/search_test.mjs` (ya en CI) + prueba manual de carga a decks.

### Fase 2 — Mezcla y controles de plato
**Qué:** cablear EQ **HI/MID/LOW** (×2), **faders** de canal, **pitch ±8%**, **SYNC**, **keylock**,
**Loops** (4/8 beats · IN · OUT · reloop), **Hotcues 1-4**, **beatjump** (`< >`), y mostrar
**BPM / tono / waveform** reales del motor. Medidores **VU** Cue/Master y pre-escucha (cue).
**Archivos:** `console.html`, controlador overlay, `engine_worker.js`/`audio_bridge.js` (solo si
falta exponer algún control).
**Criterio verde:** cada control mueve el audio real; la waveform y el BPM corresponden a la pista
cargada; VU se mueve con el nivel.
**Prueba:** comprobación en navegador control por control; donde aplique, prueba unitaria del puente.

### Fase 3 — IA Copiloto y modos de operación
**Qué:** cablear el panel IA Copiloto a `copilot.js` (sugerencia de **siguiente pista compatible**,
**armonía Camelot**, **energía**); activar **DJ Manual / Híbrido / Automático 24/7**.
**Archivos:** `console.html`, controlador overlay, `copilot.js`, modo auto.
**Criterio verde:** el copiloto propone una pista realmente compatible (armonía+BPM+energía) de la
biblioteca; el modo Automático encadena sin cortar el audio.
**Prueba:** unitaria del copiloto (compatibilidad) + prueba de encadenado en navegador.

### Fase 4 — Extras de sonido
**Qué:** **Control MIDI** (`midi.js`, MIDI-Learn), **grabación** de sesión (`audio_bridge.js`).
**Micrófono / Talkover**: NOTA — esto **no es cableado**, es **desarrollo menor** (requiere
`getUserMedia` + ducking de la música). Se incluye aquí por ser «sonido».
**Criterio verde:** un controlador MIDI mueve los controles; el micrófono entra a la mezcla y el
talkover atenúa la música.
**Prueba:** `midi.js` con mensajes sintéticos (ya testeable) + prueba física de micro (documentada
como prueba que requiere hardware).

### Cierre del Bloque 1 — Consola de música en verde
- Actualizar `.github/workflows/ci.yml` con las pruebas de cada fase.
- Documento de evidencia: `docs/etapa_b/B_EVIDENCIA_MUSICA.md` (qué quedó verde, con capturas y
  resultados de prueba).
- La consola de **música/sonido** queda 100% funcional sobre la imagen aprobada.

---

## BLOQUE 2 — VIDEO / AUDIOVISUAL (desarrollo nuevo)

> Todo esto es 🔴 en el inventario: **no hay backend**. Es desarrollo, no cableado. Orden sugerido:

### Fase 5 — Video/VJ básico
Cargar y reproducir **video** en un deck de video; salida a un lienzo. Categoría «Videos» de la
biblioteca. (Requiere definir el pipeline de video del navegador.)

### Fase 6 — Preview → Programa («Enviar a vivo»)
Doble buffer **Previsualización/Programa**, botón **Enviar a vivo**, **transiciones** (Desvanecer…).

### Fase 7 — Dobles pantallas / Salidas de video
**Pantalla 1 (Principal)** y **Pantalla 2 (Extendida)** (p. ej. `window.open`/Presentation API).

### Fase 8 — Presentaciones / Eventos
Reproducir **PPT/slides**; categoría «Presentaciones».

### Fase 9 — Generar contenido con IA
**Video / Imagen / Presentación** con IA (requiere motor de IA y su backend; pendiente de definir
proveedor y costos).

### Cierre del Bloque 2
- CI con pruebas de video donde sea automatizable.
- Documento `docs/etapa_b/B_EVIDENCIA_VIDEO.md`.

---

## Reglas de ejecución (todas las fases)
- Rama por fase (`claude/etapa-b-fase-N-...`) y **PR en borrador**; sin merge ni despliegue sin tu OK.
- No tocar `main`, Coolify/Hetzner productivos ni la base de datos.
- Respetar la imagen aprobada; controles transparentes encima.
- Antes de decir «verde»: ejecutar la prueba y mostrar el resultado real. Lo que requiera hardware
  (micrófono, controlador MIDI físico, pantallas) se marca como **prueba física pendiente**, no como
  éxito automático.

## Orden de arranque sugerido
**Fase 0 → Fase 1** (buscador → cargar a A/B) primero, porque desbloquean todo el resto del Bloque 1.
