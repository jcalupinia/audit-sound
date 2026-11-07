# Registro de observaciones y riesgos — versión 0.6

El frontend cumple su papel de interfaz interactiva y contrato inicial, pero **no está autorizado para producción ni comercialización todavía**.

| ID | Severidad | Hallazgo | Estado / acción requerida |
|---|---|---|---|
| P0-01 | Crítico para producción | Backend real C++ / Control API no conectado ni auditado en esta sesión | Verificar endpoints, autenticar, sincronizar y ejecutar pruebas integradas |
| P0-02 | Crítico para producción | Login demo y RBAC solo visual; usuarios y licencias en almacenamiento local | Identity Provider, autorización de servidor y aislamiento multiempresa |
| P0-03 | Crítico para producción | AutoMix continuo 24/7 no probado | Motor servidor autónomo, cola persistente, fallback, 8h+ test |
| P0-04 | Crítico para producción | Pérdida de derechos o términos musicales si se integra catálogo externo sin licencia | Revisión legal licencias de software/audio/transmisión |
| P1-01 | Alto | Dos salidas de audífonos CUE / master separadas no existen en frontend local | Enrutamiento de dispositivos y motor AudioWorklet/C++ |
| P1-02 | Alto | Video de programa usa mezcla visual CSS local, no encoder VJ | Compositor sincronizado, capturador y salida independiente |
| P1-03 | Alto | FX banco y presets son controles; DSP externo faltante | Algoritmos, contratos y pruebas de audio |
| P1-04 | Alto | Qwen/DeepSeek desconectados, chat mock | Audi Brain Runner, gateway, tokens, límites y permisos |
| P1-05 | Alto | Micrófonos no llegan al master; se solicita permiso sin monitoreo ni retransmisión | Mezclador mic/aux y talkover DSP con control de feedback |
| P1-06 | Alto | WebRTC, WebCodecs, WASM/AudioWorklet, MIDI, vídeo en pantallas externas no conectados | Implementar adaptadores especializados |
| P1-07 | Alto | Sin prueba real en iOS/Android con pantalla bloqueada | Dispositivos físicos y streaming continuo remoto |
| P1-08 | Medio | CSS data poster contiene parte de gráficos promocionales | Sustituir por póster neutro o vistas reales para la versión comercial |
| P2-01 | Medio | La UI está escrita en JS modular sin React+TS; contratos TS se verifican | Migración opcional al stack preferido del proyecto |
| P2-02 | Medio | QA actual usa Playwright Python, no Vitest/React Testing Library | Si se migra a React, añadir esas suites y CI |
| P2-03 | Medio | Validación de roles/plan es del cliente y localStorage | Backend fuente de verdad y pruebas de seguridad |
| P2-04 | Medio | Eventos mock pueden saturar el registro con ajustes de fader | Throttling/debouncing en el adaptador real |
| P2-05 | Medio | Medidores VU visuales, sin analizador de señal real | FFT/analyser del motor con calibración |
| P2-06 | Medio | Los módulos fuente comparten cierre léxico concatenado y no son ES Modules aislados | Separar dependencias y migrar a bundler en próxima iteración |
| P2-07 | Medio | Persistencia de bibliotecas de archivo no se conserva tras refresh (Object URLs) | Catálogo servidor y base de medios persistente |

## Dictamen

**APROBADO CON OBSERVACIONES — únicamente como frontend de demostración técnica y base para integración de backend.**

**NO APROBADO PARA PRODUCCIÓN.** Este resultado no certifica funciones de backend, infraestructura, seguridad comercial ni derechos de contenido. Las incidencias P0/P1 son bloqueos de salida a mercado, no defectos ocultos del código entregado.
