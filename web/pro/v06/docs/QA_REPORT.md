# AUDIT SOUND — Informe técnico de calidad del frontend v0.6.0

## Dictamen

**APROBADO CON OBSERVACIONES para entrega de frontend DEMO cableable.**

**NO APROBADO PARA PRODUCCIÓN NI COMERCIALIZACIÓN.** No se certifica integración del motor C++, agentes IA, streaming, seguridad real ni facturación. No hubo auditoría independiente externa de código; la evidencia la generan scripts automatizados reproducibles.

## Alcance de validación

- Código de interfaz, activos visuales e interactividad local.
- Cobertura de las 20 pantallas RF-01.
- Eventos `data-action` y `data-change`, IDs DOM y ausencia de botones huérfanos.
- Comportamiento responsivo en Chromium: 390×844, 768×1024, 1366×768 y 1920×1080.
- Reproducción de WAV de prueba real en Deck A mediante Web Audio y crossfader.
- Cambio de modo DJ durante reproducción sin detener el audio.
- Carga de MP4 de prueba real en Video Deck A y salida de Programa local.
- Validación TypeScript de contratos propuestos, sintaxis JS, generación de HTML autónomo.

## Ejecución y métricas

| Evaluación | Resultado |
|---|---|
| Rutas/pantallas únicas | 20 de 20 comprobadas |
| Botones con acción explícita por recorrido de rutas | 146 |
| Controles inventariados, incluidos formularios e inputs | 291 |
| Tipos de acción de botones identificados en interfaz | 58 |
| Identificadores DOM duplicados por pantalla | 0 |
| Botones sin `data-action` o `type=submit` | 0 |
| Overflow horizontal en resoluciones verificadas | 0 |
| Excepciones JavaScript no capturadas en flujos revisados | 0 |
| Web Audio con WAV original de prueba | PASS |
| Video HTML5 con MP4 de prueba | PASS |
| Persistencia de playback al cambiar modo DJ | PASS |
| Compilación/sintaxis JavaScript (`node --check`) | PASS |
| Contratos TypeScript (`tsc --noEmit --strict`) | PASS |
| Pruebas unitarias React/Vitest | NO APLICABLE: UI nativa, sin React |
| Tests Playwright Python | PASS |
| Backend C++ / IA / VJ / Icecast / autenticación | NO VERIFICADO, NO CONECTADO |
| iOS / Android físico / pantalla bloqueada | NO VERIFICADO |

### Incidencias encontradas y corregidas

1. En entorno de QA, Chromium bloqueó la navegación a `file://` y a `127.0.0.1`. Solución: generar HTML autocontenido e inyectarlo con `set_content` para probar el DOM real. **Esto no certifica un doble clic en todos los clientes de Chrome**, aunque elimina dependencias externas.
2. El cambio de `hash` ocasionaba carreras en navegación rápida de pruebas. Se eliminó; la navegación usa estado de la SPA.
3. Overflow horizontal en consola a 768px. Corregido con media queries específicas para la rejilla de decks.
4. Se añadieron IDs DOM a todos los controles visibles para trazabilidad y cableado.
5. Se comprobó que el cambio de modo DJ no recrea el elemento de audio persistente.

### Riesgos no resueltos

Consultar `PENDIENTES_Y_RIESGOS.md`. Principales: falta de autenticación y autorizaciones reales; faltan FX DSP, cue bus, video codificado, micrófonos al master, Qwen/DeepSeek e Icecast; falta validación en dispositivos físicos. Los contratos OpenAPI son propuestas iniciales para consensuar con el repositorio, no endpoints reales auditados.

## Evidencias

- `docs/QA_BROWSER_METRICS.json`: controles, 20 pantallas, IDs, viewport widths, excepciones.
- `docs/UI_CONTROL_REGISTRY.csv`: identificadores individuales y acciones de controles.
- `docs/MATRIZ_TRAZABILIDAD.csv`: requisitos RF01–RF08 y estatus.
- `dist/captura_consola_desktop.png`, `captura_consola_movil.png`, `captura_video_desktop.png`, `captura_video_archivo_real.png`.
- `tests/test_browser.py`, `tests/test_quality.py`, `tests/test_media.py`.

## Limitaciones del dictamen

El frontend sí existe y se puede probar como software web sin componentes decorativos falsos; **no equivale a la implementación completa de los algoritmos de la arquitectura**. La conformidad se restringe al frontend navegable y al contrato inicial listo para ser reconciliado con Claude Code. No debe rotularse como versión comercial final.
