# Inventario Frontend (imagen aprobada) vs Backend — AUDIT SOUND

**Fecha:** 2026-11-05
**Alcance:** comparar cada elemento visible en la consola aprobada (`web/pro/console.html`,
imagen `assets/landing_consola.webp`) contra el backend/módulos que ya existen en el repo,
para decidir qué se puede **cablear** (ya hay backend) y qué está **pendiente de desarrollar**.

> Verificado leyendo el código en `main`, no de memoria. Referencias de archivo al final.

## Leyenda
- 🟢 **Ya cableado** — funciona hoy en `console.html` (etapa 1).
- 🟡 **Existe backend → cableable** — la lógica ya está en un módulo; solo falta engancharla a la imagen.
- 🔴 **Pendiente de desarrollar** — no hay backend; `console.js` lo marca «próximamente».

---

## Platos A y B (DJ)
| Elemento de la imagen | Estado | Origen |
|---|---|---|
| ▶❚❚ Play / CUE A y B | 🟢 | etapa 1 (`console.html`); el motor real da más |
| Cargar pista a A/B | 🟡 | `engine load` + biblioteca/búsqueda |
| BPM (126.0) y tono (8A) | 🟡 | motor (`loaded` → bpm/key) |
| Waveform | 🟡 | motor (`dj_waveform_bins`/`dj_waveform_copy`) |
| Pitch ±8% | 🟡 | `engine rate` |
| SYNC | 🟡 | `engine rate` (beatmatch) |
| Candado (keylock) | 🟡 | `engine keylock` |
| Loop (4/8 Beats · IN · OUT · reloop) | 🟡 | `engine loop(bars)` |
| Hotcues 1-4 | 🟡 | `engine hotcue_set/jump/clear` |
| `< >` (beatjump) | 🟡 | `engine beatjump` |
| Jog wheel (scratch/seek) | 🟡 parcial | `engine seek` (scratch fino por afinar) |

## Mezclador central
| Elemento | Estado | Origen |
|---|---|---|
| EQ HI / MID / LOW (×2) | 🟡 | `engine eq` |
| Faders de canal | 🟡 | `engine fader` |
| Crossfader | 🟢 | etapa 1 (`engine xfader`) |
| Volumen Master | 🟢 | etapa 1 (`engine master`) |
| Medidores VU (Cue / Master) | 🟡 parcial | niveles del worklet (posible medición en front) |
| Auricular / Cue (pre-escucha) | 🟡 parcial | ruteo de cue (bus separado por confirmar) |

## IA Copiloto
| Elemento | Estado | Origen |
|---|---|---|
| Sugerencias / «Siguiente en la sesión» | 🟡 | `copilot.js` (Camelot+BPM+energía; aprende) |
| Compatibilidad armónica 8A→8A | 🟡 | `copilot.keysCompatible` |
| Energía (↑+4%) | 🟡 | `copilot` (pesos harmony/tempo/energy) |
| Tipo (Dance/Pop) | 🟡 parcial | por mapear a metadatos |
| Transición «16 beats (suave)» | 🟡 parcial | `copilot` sugiere punto; conteo fino por afinar |
| Tab «Transiciones» (video) | 🔴 | stub |
| Tab «Contenido IA» | 🔴 | stub |

## Modos y vista
| Elemento | Estado | Origen |
|---|---|---|
| DJ Manual / Híbrido | 🟡 | motor + `copilot.js` |
| DJ Automático 24/7 | 🟡 | modo auto (`mixer.html::autoToggle`) |
| Vista Sencillo / Profesional | 🟡 | toggle de UI (sin backend) |

## Biblioteca multimedia
| Elemento | Estado | Origen |
|---|---|---|
| Buscar + filtros Tipo/Género/BPM | 🟡 | `search.js` (4 fuentes, licencia, dedup, cancelación) |
| Categoría Música / Favoritos / Toda | 🟡 | `library.js` (IndexedDB, persistente) |
| Fuente Navidrome | 🟡 | `subsonic.js` |
| Fuente Jamendo / Internet Archive | 🟡 | `openmusic.js` / `archive.js` (proxy backend) |
| Importar Archivos | 🟢 | etapa 1 |
| Ítems de audio → cargar a deck | 🟡 | `library` + `engine load` |
| Categorías Videos / Imágenes / Presentaciones / Generados por IA | 🔴 | sin backend de esos medios |

## Centro audiovisual y footer
| Elemento | Estado | Origen |
|---|---|---|
| Previsualización (Preparar) | 🔴 | stub «backend de video próximamente» |
| Salida en vivo (Programa) / EN VIVO | 🔴 | ídem |
| «Enviar a vivo» (Preview→Programa) | 🔴 | `console.js` stub |
| Transición (Desvanecer…) de video | 🔴 | stub |
| Generar con IA: Video / Imagen / Presentación | 🔴 | stub «motor de IA próximamente» |
| Micrófono | 🟢 | v0.6 `07b-microfonos.js` → agente → motor (`/api/voice`). Ver `docs/dj-agent/21_MICROFONOS_TALKOVER.md` |
| Talkover | 🟢 | Automático / Siempre / Apagado, en la consola y en el motor (stream) |
| Salidas de video (Pantalla 1 / 2) | 🔴 | sin backend de pantallas |
| Pantalla completa | 🟡 | `requestFullscreen` (trivial) |
| Barra «En vivo / BPM / 8A / tiempo» | 🟡 | estado del motor |

## Barra superior / navegación
| Elemento | Estado | Origen |
|---|---|---|
| Icono usuario ▾ → Salir | 🟢 | `commandcenter.logout()` |
| Nav: Consola (actual) | 🟢 | página actual |
| Nav: Biblioteca / Playlists / Configuración | 🟡 parcial | `library`/`search` existen (audio); faltan las páginas |
| Nav: Eventos / Generador IA | 🔴 | sin backend |

## Capacidades que ya existen y la imagen no muestra (bonus)
- 🟡 Control **MIDI** con MIDI-Learn (`midi.js`).
- 🟡 **Grabación** de la sesión (máster → Blob) (`audio_bridge.js`).
- 🟡 Conversión/decodificación de audio (`converter.js`).

---

## Resumen
- **🟢 Ya funciona:** importar, play/cue A-B, crossfader, master, salir (~6 controles).
- **🟡 Backend listo, solo falta cablear a la imagen (MÚSICA/DJ completo):** buscador 4 fuentes,
  cargar a decks, EQ, faders, SYNC, pitch, keylock, loops, hotcues, beatjump, BPM/tono/waveform,
  IA Copiloto, DJ Manual/Híbrido/Automático, biblioteca persistente, Navidrome, MIDI, grabación.
- **🔴 Pendiente de desarrollar (AUDIOVISUAL):** Video/VJ, Presentaciones/Eventos, Preview→Programa,
  «Enviar a vivo», transiciones de video, Generar con IA (video/imagen/presentación),
  Micrófono/Talkover, dobles pantallas/Salidas de video, categorías de biblioteca no-audio.

**Conclusión:** toda la parte de **música/sonido/consola DJ** ya está desarrollada en el backend y
solo falta **engancharla** a la imagen aprobada; toda la parte **audiovisual** está pendiente de
desarrollar. El plan de ejecución está en `PLAN_ETAPA_B.md` (mismo directorio).

## Dato clave de arquitectura
- `web/pro/console.html` (imagen aprobada) hoy usa un reproductor **HTML5 `<audio>`** simple (etapa 1).
- El DJ real (EQ, SYNC, loops, hotcues, waveform) vive en el **motor WASM + AudioWorklet**
  (`audio_bridge.js` + `engine_worker.js`), hoy cableado en `web/pro/mixer.html`.
- Existe además `web/pro/console.js` (602 líneas): un controlador que engancha motor + `search.js` +
  `copilot.js` a una «consola verde», pero **ningún HTML lo carga** (quedó huérfano al introducir la
  consola-imagen). Reutilizable para el cableado de la Etapa B.

## Referencias de archivo
- Motor: `web/pro/audio_bridge.js`, `web/pro/engine_worker.js`, `web/pro/ring.js`, `wasm/` (WASM).
- Buscador/fuentes: `web/pro/search.js`, `openmusic.js`, `archive.js`, `subsonic.js`, `library.js`.
- Copiloto/MIDI: `web/pro/copilot.js`, `web/pro/midi.js`.
- Controlador huérfano: `web/pro/console.js`.
- Consola-imagen actual: `web/pro/console.html`.
- Mezclador funcional de referencia: `web/pro/mixer.html`.
- Proxy de música: `deploy/pro/server.js` (`/api/openmusic/*`, `/api/archive/*`).
