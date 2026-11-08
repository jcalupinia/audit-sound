# Propuesta · Bloque 2: video y audiovisual

> **Estado:** propuesta para decisión del dueño (2026-11-08). No se ha escrito código de esta propuesta.
> Reemplaza el esbozo del Bloque 2 en `PLAN_ETAPA_B.md` (fases 5 a 9). Las fases se llaman **V1…V6** para no
> confundirlas con las fases del Agente DJ.

## 1. Dónde estamos (verificado en el código)

La pantalla «Mezcladora de video / VJ» de la v0.6 (`web/pro/v06/src/modules/02-screens.js::videoPage`) funciona
**solo en el navegador de quien la usa**:

| Funciona hoy | No existe todavía |
|---|---|
| Cargar 2 videos del equipo (decks A y B), reproducir, pausar, CUE, LOOP | Biblioteca de videos que se guarde (cada vez hay que volver a cargarlos) |
| Mezcla A ↔ B con transparencia (CSS) | Transiciones reales (barrido), efectos (desenfoque, glitch), texto encima |
| «Enviar a programa» muestra la mezcla en un recuadro local | Salida a un proyector o TV (Pantalla 2) |
| Botón de pantalla completa | Transmisión del video por internet |
| — | Presentaciones (diapositivas) en eventos |
| — | Generar imágenes o video con IA |

Los riesgos ya documentados en la v0.6 son `PENDIENTES_Y_RIESGOS.md` P1-02 (la mezcla es CSS, no un compositor real) y
P1-06 (sin salida a pantallas externas). Los contratos de la API de video están **propuestos** pero sin servidor
(`contracts/openapi-propuesto.yaml`: `/api/v1/video/crossfader`, `/decks/{deck}/transport`, `/outputs`,
`/program/take`).

## 2. Las decisiones que necesito de usted

### D1 · ¿Quién ve el video? (la más importante)

| Opción | Qué significa | Costo y dificultad |
|---|---|---|
| **A. Solo en el local** | El video sale por un proyector o TV conectado al computador del DJ | Bajo. Todo ocurre en el navegador; el servidor no cambia |
| **B. También por internet** | Los oyentes remotos ven el video además de oír la música | Alto. Hace falta un servidor de video y mucho más tráfico (§5) |
| **C. Por etapas (recomendada)** | Primero A; B solo si el uso lo justifica | Se paga lo de B solo cuando haga falta |

### D2 · ¿De dónde salen los videos?
- **Recomendado:** archivos que suba el DJ (loops visuales, videos propios, logos), guardados en la biblioteca del
  navegador, igual que la música. Más adelante, una carpeta en el servidor.
- **No recomendado:** videos de YouTube u otras plataformas. Sus condiciones no permiten reproducirlos en un evento
  ni retransmitirlos, y además se cortan con publicidad.

### D3 · ¿El video lleva sonido? — **DECIDIDO (2026-11-08): ambos modos**
- **Visuales (sin sonido):** loops y videos de ambientación. El audio lo pone el motor de música, como hoy.
- **Videoclips (DJ de video):** cada video trae su canción. El sonido pasa por el motor de audio (ecualizador, BPM,
  sincronía, AutoMix) y la imagen va enganchada a ese sonido. Un solo crossfader mezcla imagen y sonido a la vez.
  - Verificado en el código: el decodificador del motor (`engine/ffmpeg_aac.hpp`, FFmpeg) ya lee el audio de MP4.
    Falta que `tools/audit_sound_server.cpp::isAudio` acepte `.mp4` (hoy: mp3, wav, flac, opus, ogg, m4a, aac, m4b),
    y lo mismo en el motor WASM de la consola.
  - Objetivo de sincronía labios-voz: desfase ≤ 80 ms, medido en las pruebas.
  - Derechos: los videoclips oficiales requieren licencia de comunicación pública para eventos o transmisiones.

### D4 · Generar con IA
La firma tiene un servidor de medios local («AuditIA Media Local», con generar imagen, generar video y animar
imagen). **Recomendado:** usarlo primero, por privacidad y costo cero, igual que Qwen para el agente. Un proveedor en
la nube queda solo como respaldo, con un tope de gasto. Antes de comprometerlo hay que medir cuánto tarda en generar
un clip; no está verificado.

## 3. Arquitectura propuesta (resumen)

```
                 computador del DJ (navegador)
 ┌──────────────────────────────────────────────────────────────┐
 │ Decks de video A/B ─► Compositor WebGL (GPU): mezcla,         │
 │ Biblioteca de videos   transiciones, efectos, texto, logo     │
 │ Diapositivas (PDF)            │                               │
 │                               ├─► Preview (en la consola)     │
 │                               └─► Programa ──► ventana en el  │
 │                                    proyector/TV (Pantalla 2)  │
 └───────────────────────────────┬──────────────────────────────┘
                                 │ solo si D1 = B o C (fase V5)
                                 ▼ WHIP (WebRTC)
                     servidor (Coolify): MediaMTX ─► HLS ─► oyentes remotos
                     + audio del motor (Icecast) unido al video
```

Principios:
- **El audio nunca depende del video.** Si el video se cuelga, la música sigue, la misma regla que con el agente.
- **El servidor no recodifica video.** Codifica el navegador del DJ y el servidor solo reenvía. Así el servidor
  pequeño de Hetzner aguanta.
- Se reutilizan los contratos ya propuestos (`/api/v1/video/*`) para que el Agente DJ pueda mandar órdenes de video
  más adelante.

## 4. Fases propuestas

Las estimaciones son orientativas, como en la arquitectura del agente. Cada fase va en su propia rama y PR, y no
se hace merge ni despliegue sin su autorización.

| Fase | Qué se entrega | Cómo se prueba | Depende de | Estimación |
|---|---|---|---|---|
| **V1 · Compositor de video** | Mezcla A/B por GPU (WebGL); transiciones Desvanecer/Corte/Barrido; efectos (brillo, desenfoque, glitch); texto y logo encima; biblioteca de videos que se guarda; categoría «Videos» | E2E en Chromium con `tests/sample.mp4`: se leen píxeles del lienzo para comprobar mezcla y transición; rendimiento (cuadros por segundo) | D2, D3 | 3–4 días |
| **V1b · Videoclips (DJ de video)** | `.mp4` en el motor (servidor y WASM); al cargar un videoclip, su audio va al deck de audio y su imagen al deck de video del mismo lado; un crossfader para ambos; la imagen sigue la posición, el pitch y los saltos del audio; categoría «Videoclips» | E2E con un videoclip de prueba: se mide el desfase imagen-sonido (≤ 80 ms) tras play, CUE, cambio de pitch y crossfade; pruebas del motor C++ | V1 | 3–4 días |
| **V2 · Preview → Programa y Pantalla 2** | «Enviar a programa» real con la transición elegida; ventana «Programa» a pantalla completa en el proyector/TV, controlada desde la consola; botón de pánico (logo fijo) | E2E con dos ventanas; **prueba física pendiente** con proyector real | V1 | 2–3 días |
| **V3 · Presentaciones y eventos** | Diapositivas desde PDF e imágenes (PowerPoint convertido a PDF); los cues del evento disparan diapositivas o videos a una hora | E2E con un PDF de ejemplo y un evento programado | V2 | 2–3 días |
| **V4 · Agente DJ con video** (opcional) | Órdenes «pon el video de playa», «cambia los visuales con la energía»; cortes de video al ritmo (BPM) en modo automático | Pruebas del agente + E2E | V2 y el agente desplegado | 2–3 días |
| **V5 · Transmisión por internet** (solo si D1 = B o C) | Servicio MediaMTX en el compose; el navegador envía el programa por WHIP; los oyentes ven HLS con el audio del motor; página de reproducción; acceso solo con sesión AUDIT-IA si se desea | Ensayo local completo (navegador → MediaMTX → HLS → reproductor) y luego despliegue autorizado | V2, D1 | 4–5 días |
| **V6 · Generar con IA** | Imagen/video/animación desde un texto con el servidor de medios local; el resultado entra a la biblioteca «Generados por IA» y siempre se revisa antes de ir a programa | Prueba contra el servidor real (si está accesible) y tiempos medidos | D4 | 2–3 días |

Orden recomendado: **V1 → V1b → V2 → V3**, que ya dejan un VJ útil en un evento presencial. Después, V4, V5 y V6 según lo
que decida.

Pendiente aparte del Bloque 1 (sonido): micrófonos y talkover (la Fase 4 original) siguen sin servidor. Para eventos
con presentaciones conviene hacerlos junto con V3. Propongo incluirlos ahí si está de acuerdo.

## 5. Números para decidir D1 (transmisión por internet)

- Video 720p de calidad aceptable: ~3 megabits por segundo **por cada espectador**.
- **1 espectador durante 1 hora ≈ 1,35 GB** de tráfico (3 Mb/s × 3.600 s ÷ 8).
- 50 espectadores × 4 horas ≈ **270 GB** por evento. El audio solo (128 kb/s) gasta unas 23 veces menos.
- Hay que **verificar el tráfico incluido en el plan del servidor Hetzner** antes de activar V5. No lo he
  comprobado. Si no alcanza, la alternativa es un servicio externo de distribución (CDN), con costo mensual.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Imagen y sonido del videoclip se desfasan | La imagen sigue al reloj del motor de audio (nunca al revés) y se corrige si pasa de 80 ms; medido en E2E |
| El computador del DJ no tiene GPU suficiente | Limitar a 720p, medir cuadros por segundo en V1 y bajar la calidad automáticamente |
| iPhone/Safari: no reproduce automático con sonido y no tiene la API de presentación | La imagen va siempre sin sonido propio (el sonido de los videoclips lo pone el motor); la Pantalla 2 se abre como ventana normal. Se prueba en dispositivo físico |
| Derechos de autor de los videos | Solo archivos propios o con licencia (D2); aviso en la biblioteca |
| Tráfico y costo de transmitir video | V5 opcional y con números previos (§5) |
| La IA genera algo inapropiado | Nada generado va a programa sin que una persona lo apruebe (misma regla que el agente) |

## 7. Qué hago apenas usted decida

D3 ya está decidida (ambos modos). Con D1, D2 y D4 respondidas (o «acepto las recomendadas»), abro la rama de **V1**, construyo el compositor y entrego
el PR con sus pruebas, como en las fases del agente.
