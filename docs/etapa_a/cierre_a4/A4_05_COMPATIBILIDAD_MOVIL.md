# A4-05 — Compatibilidad móvil

## Qué se mantuvo (sin rediseñar ni cambiar la identidad visual)

- **Modos DJ:** Manual, Híbrido (IA Copiloto), Automático 24/7.
- **Vistas:** Sencillo / Profesional.
- **Fuentes:** Navidrome, Jamendo, Internet Archive, biblioteca local.
- No se sustituyeron funciones reales por controles decorativos.

## Dos superficies en móvil

1. **Consola PRO** (`/pro/`, WebAssembly). Funciona en navegadores con **HTTPS +
   aislamiento de origen (COOP/COEP → SharedArrayBuffer) + AudioWorklet** (Chrome/Edge en
   computadora, Android, e iOS 15.2+). Sin esas capacidades, un **guard** muestra un aviso
   y apunta a la página de escucha, en vez de fallar a ciegas. (La única función que iOS
   no soporta es «Guardar como Opus» por WebCodecs; ya está deshabilitada con aviso.)
2. **Página de escucha** (`web/index.html`): `<audio playsinline>` + Media Session
   (controles de pantalla bloqueada), pensada para iPhone.

## Pruebas automatizadas disponibles (emulación — NO dispositivo físico)

Emulación Playwright (iPhone 13 y Pixel 5), **11/11** en la Etapa A previa:
- Página de escucha renderiza; `playsinline` presente; Media Session cableado; sin scroll
  horizontal.
- Consola PRO en iPhone (sin aislamiento): muestra el aviso y no arranca a ciegas.

> **Límite honesto:** esto es **emulación de navegador**, no hardware real. Las pruebas
> **físicas** que requieren intervención humana quedan explícitamente identificadas:

## Pruebas físicas que requieren intervención humana (pendientes)

- iPhone real (Safari): abrir la consola PRO por HTTPS y confirmar que arranca el motor;
  abrir la página de escucha y confirmar reproducción con **pantalla bloqueada**.
- Android real (Chrome): consola PRO completa (incluida la conversión Opus).
- Latencia/estabilidad de audio en redes móviles reales.

Estas no se pueden ejecutar automáticamente en el entorno de CI/sesión.
