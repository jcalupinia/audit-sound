# AUDIT SOUND · Command Center PRO · Frontend v0.6.0

**Estado: frontend navegable y probado en Chromium; NO APTO PARA PRODUCCIÓN.**

Este proyecto reemplaza la maqueta fotográfica por controles web reales. Incluye la imagen aprobada de la DJ **solo como recurso visual**, integrada en el encabezado `IA Copiloto` y su avatar.

## Abrirlo inmediatamente

**Sin instalación:** abrir `dist/AUDIT_SOUND_V06_ABRIR_EN_CHROME.html` en Chrome o Edge (doble clic). Contiene todo el CSS, JavaScript y recursos visuales incrustados; no requiere internet. Pulsar **«Abrir demostración sin credenciales»**. Nunca introducir claves reales en el formulario demo.

**Proyecto modular:** abrir `index.html` junto a `src/` y `assets/`, o servir la carpeta:

```bash
python3 -m http.server 8080
```

Luego abrir `http://localhost:8080`. Recomendado para recursos multimedia/voz y el desarrollo. No incluye un servidor de autenticación ni de transmisión.

## Estructura

```text
AUDIT_SOUND_FRONTEND_PRO_V06/
├── index.html                    # shell de aplicación
├── assets/                       # imágenes aprobadas y carteles de video
├── src/
│   ├── styles.css                # diseño premium responsive
│   ├── app.js                    # bundle generado por build.py
│   └── modules/
│       ├── 01-core-console.js     # estado, comandos, consola, audio UI
│       ├── 02-screens.js          # 20 páginas reales
│       ├── 03-actions-audio-video.js # comandos y WebAudio
│       └── 04-events-forms.js     # formularios, eventos, validación
├── contracts/
│   ├── types.ts                  # tipos TypeScript / contrato de comandos
│   ├── tsconfig.json
│   ├── event-registry.json       # 38 comandos y rutas propuestas
│   └── openapi-propuesto.yaml    # propuesta, NO backend verificado
├── docs/
│   ├── ARQUITECTURA.md
│   ├── MATRIZ_TRAZABILIDAD.csv
│   ├── UI_CONTROL_REGISTRY.csv
│   ├── QA_REPORT.md
│   ├── QA_BROWSER_METRICS.json
│   ├── INTEGRACION_CLAUDE_CODE.md
│   └── PENDIENTES_Y_RIESGOS.md
├── tests/
│   ├── test_browser.py           # Playwright Python
│   ├── test_media.py             # WAV real y MP4 real
│   ├── test_quality.py           # cobertura, IDs, eventos, responsive
│   ├── sample.wav                # pista de test original, tono sintético
│   └── sample.mp4                # video de prueba generado, color azul
├── scripts/
│   ├── build.py                  # bundle autónomo reproducible
│   ├── contracts.py              # regenerar OpenAPI/TS
│   └── ui_inventory.py           # inventario automatizado de controles
├── dist/
│   ├── AUDIT_SOUND_V06_ABRIR_EN_CHROME.html
│   └── capturas*.png
└── package.json
```

### Comandos de desarrollo y QA

```bash
python3 scripts/build.py
node --check src/app.js
tsc --project contracts/tsconfig.json --pretty false
python3 tests/test_browser.py
python3 tests/test_media.py
python3 tests/test_quality.py
python3 scripts/ui_inventory.py
```

Requiere Python 3.10+, Chromium y Playwright Python para ejecutar las pruebas. Los artefactos ya generados funcionan sin esas dependencias. El proyecto no usa dependencias npm ni servicios de terceros; se eligió esa estrategia para que el HTML descargado pueda ejecutarse sin instalación y probarse completamente aun sin acceso al registro npm. **Es una desviación consciente de la preferencia React+TypeScript del prompt; la capa de contratos está tipada con TypeScript, pero la UI está implementada en JavaScript nativo modular y consolidado.** Una migración a React+TS puede realizarse posteriormente si se aprueba.

## Funcionalidad implementada en el navegador

- 20 pantallas y navegación responsive (escritorio, tablet y móvil).
- Controles HTML reales para decks, modo DJ, biblioteca, cola, listas y políticas.
- Importación real de audio/video local mediante `input[type=file]` y `URL.createObjectURL`.
- Dos decks de audio con Web Audio API, EQ HI/MID/LOW, ganancias, faders, crossfader de potencia igual y master; hotcues/beatjump/loop como controles de transporte local.
- Dos reproductores HTML5 de video; previsualización y programa **solo local**, mezcla visual por opacidad CSS y botón Take.
- Panel de Qwen/DeepSeek, historial e instrucciones **MOCK claramente identificado**; dictado Web Speech sujeto a navegador.
- Cuatro canales de micrófono como controles y consulta voluntaria de dispositivos. No se hace monitorización de micrófono ni mezcla con el master.
- Dos bancos FX y presets; generador de plantilla `.js` para DSP futuro (plantilla no ejecutable).
- Eventos/escenas, playlists, usuarios demo, permisos, licencias, planes e invoices **simulados y almacenados localmente**.
- Eventos estructurados mediante `window.dispatchEvent(new CustomEvent('auditsound:command', {detail}))`.
- Estados de error mediante avisos y estado «sin conexión» de los servicios reales.

## Qué NO hace y no debe anunciarse como listo

No implementa autenticación real, control remoto, streaming Icecast, mezcla real de señales de micrófono, preescucha de audífonos separada, DSP FX, mezcla de video codificada para emisión, planificación Qwen/DeepSeek, licenciamiento SaaS ni facturación. Las operaciones `api/*` son **contratos propuestos**, no endpoints confirmados del repositorio. No se validó hardware real MIDI, iPhone/Android ni reproducción 24/7.

Consultar `docs/QA_REPORT.md` y `docs/PENDIENTES_Y_RIESGOS.md` antes de integrar el backend.
