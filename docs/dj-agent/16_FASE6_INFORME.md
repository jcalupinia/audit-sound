# 16 · Fase 6 — Informe de entrega (voz y móvil)

> **Estado:** en revisión. Rama `claude/dj-agent-fase6`. Sin despliegue ni cambios en producción.
> **Dispositivos físicos: NO VERIFICADO.** El micrófono se simuló y los teléfonos se emularon en Chromium
> (sin WebKit): hace falta la prueba en un iPhone y un Android reales (guía en `deploy/PROBAR_IPHONE.md`, sección C).

## 1. Alcance entregado

| Elemento | Estado | Evidencia |
|---|---|---|
| Dictado con iniciar/detener, texto parcial y final, idioma `es-EC` | **REAL** (navegador) | `voice_mobile_e2e.mjs` |
| El dictado **nunca envía solo**: el texto queda en el cuadro para revisarlo | **REAL** | E2E |
| Aviso de privacidad (el dictado lo hace el navegador; AUDIT SOUND no graba audio) | **REAL** | E2E |
| Errores en español: permiso denegado, sin voz, sin micrófono, sin red, sin HTTPS, navegador sin dictado | **REAL** | E2E (denegado, sin voz, sin soporte) |
| Canal `voice`/`text` de la orden en la auditoría del agente (`IntentIn.channel`) | **REAL** | `test_orden_por_voz_queda_registrada_con_su_canal`; E2E |
| Acciones críticas por voz siguen exigiendo aprobación (sin cambios de permisos) | **REAL** (ya existía) | pruebas de política |
| Móvil: reconexión al volver a primer plano o recuperar la red (socket nuevo + resincronización) | **REAL** | E2E (sin red → reconexión) |
| Pulso de 25 s y reapertura si en 70 s no llega nada (sockets «medio abiertos» en móvil) | **REAL** | código; no reproducible en Chromium |
| Objetivos de toque ≥ 44 px en pantallas táctiles | **REAL** | E2E iPhone 13 y Pixel 7 emulados |
| Barra superior compacta en teléfono (64 px en vez de ~185 px) | **REAL** | E2E + capturas |
| Sin desplazamiento horizontal en teléfono | **REAL** | E2E |
| Safari de iOS real, micrófono real, segundo plano real | **NO VERIFICADO** | requiere dispositivos físicos |
| Dictado en el servidor (sin enviar audio a Google/Apple) | **NO IMPLEMENTADO** | propuesta para una fase posterior |

Mapeo: los 2 controles de voz pasan a cableados → **33 de 39**.

## 2. Hallazgos corregidos

1. Botones de 35 px en teléfono (por debajo de 44 px recomendados): corregido solo para pantallas táctiles.
2. Al volver la red, la UI seguía «reconectando»: el socket viejo figuraba abierto. Ahora se abre uno nuevo.
3. La barra superior fija ocupaba ~22 % de la pantalla del teléfono (problema previo a esta fase): compactada.
4. El dictado anterior: un solo intento sin «Detener», errores en inglés (`not-allowed`) y sin aviso de privacidad.

## 3. Pruebas ejecutadas

- `node web/pro/v06/tests/voice_mobile_e2e.mjs`: 30/30 en 3 corridas (escritorio, navegador sin dictado,
  iPhone 13 y Pixel 7 emulados con el agente real).
- `node web/pro/v06/tests/agent_live_e2e.mjs` (Fase 5): 24/24, sin regresión.
- Regresión del HTML autónomo: 20 pantallas × 4 tamaños, 0 errores.
- `pytest` del agente: 229 pasan, 5 omitidas · `ruff` limpio · `agent_proxy_test.mjs` 12/12.

## 4. Riesgos

- Privacidad del dictado del navegador: el audio sale a Google/Microsoft/Apple. Para eventos con datos
  sensibles se recomienda escribir la orden; un dictado en el servidor (Whisper local) sería la alternativa.
- En iOS el dictado web depende de la versión de Safari y del permiso del sistema.
- Las emulaciones no reproducen el comportamiento real de energía y segundo plano de iOS/Android.

## 5. Dictamen

**EN REVISIÓN.** Voz y adaptación móvil hechas y probadas en emulación. Queda **NO VERIFICADO** en dispositivos
físicos. La Fase 7 (endurecimiento, soak largo, runbook, candidato de despliegue) no se inicia sin autorización.
