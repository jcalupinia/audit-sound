# 15 · Fase 5 — Informe de entrega (cableado de la consola v0.6 al agente)

> **Estado:** en revisión. Rama `claude/dj-agent-fase5`. Sin despliegue ni cambios en producción ni en
> infraestructura (la variable `DJ_AGENT_URL` queda documentada; no se configuró en Coolify).

## 1. Alcance entregado

| Elemento | Estado | Evidencia |
|---|---|---|
| Proxy `/api/v1/dj-agent/*` HTTP + WebSocket en `deploy/pro/server.js` (`DJ_AGENT_URL`) | **REAL** | `agent_proxy_test.mjs` 12/12 (en CI) |
| Solo cabeceras permitidas; sin cookies; 503 sin configurar, 502 con el agente caído, tope de cuerpo | **REAL** | `agent_proxy_test.mjs` |
| Módulo `web/pro/v06/src/modules/05-agent-live.js` (sin rediseñar la UI) | **REAL** | E2E 24/24 (3 corridas seguidas) |
| Conexión con token de acceso (solo `sessionStorage` de la pestaña) | **REAL** | E2E |
| Modos MANUAL/HÍBRIDO/AUTOMÁTICO en el servidor; reversión si el servidor rechaza | **REAL** | E2E: 30 cambios verificados en el servidor; oyente → reversión |
| Chat y sugerencias → `POST /intent` con la respuesta real del agente | **REAL** | E2E: «salta la canción» → motor ACKNOWLEDGED |
| Reglas, autonomía, ruta de modelo y aprobación → `PUT /preferences` | **REAL** | E2E (modelo y aprobación verificados en el servidor) |
| Propuestas del servidor en «Solicitudes de aprobación»; Aprobar/Rechazar → decisión real | **REAL** | E2E |
| Eventos en vivo por WebSocket (otro cliente cambia el modo → la UI lo refleja) y reconexión con espera creciente | **REAL** | E2E: agente caído y reiniciado sin recargar |
| Etiquetas honestas: «CONECTADO/SERVIDOR REAL» solo con el agente conectado; el resto sigue «DEMO» | **REAL** | capturas |
| Sin agente configurado: modo demostración idéntico al anterior | **REAL** | E2E + regresión 20 pantallas × 4 tamaños, 0 errores |
| Voz (2 controles) | **NO CABLEADO** (Fase 6) | — |
| Permisos de la pantalla Roles (4 controles) | **NO CABLEADO** | el RBAC es fijo en el servidor |
| Login del Command Center → identidad en el agente | **NO IMPLEMENTADO** | hoy se usa un token de acceso del agente |

Mapeo actualizado: `04_MAPEO_CONTROLES_FRONTEND_V06.csv`, columna `estado_f5`: **31 de 39 controles cableados**,
6 no cableados (voz y permisos) y 2 locales por diseño.

## 2. Hallazgos corregidos durante la prueba

1. El cierre del IIFE de la aplicación estaba al final del módulo 04: el módulo nuevo quedaba fuera y no veía el
   estado. Se movió el cierre al final del módulo 05.
2. Al rechazar el servidor un cambio de modo, la UI volvía al último modo **pulsado**, no al del servidor. Ahora
   manda el servidor.
3. Un rol sin permiso de leer preferencias (oyente) no podía conectarse. Ahora esas lecturas no bloquean.
4. Con el agente conectado, la cabecera seguía diciendo «BACKEND DESCONECTADO / Sesión DEMO». Se corrigió.
5. **Un evento en vivo borraba lo que el operador estaba escribiendo** (la UI se redibuja entera). Lo detectó la
   prueba de forma intermitente (2 de 3 corridas). Ahora el redibujo por eventos conserva el texto, el foco y el
   cursor; hay una prueba de regresión.

## 3. Pruebas ejecutadas

- `node deploy/pro/agent_proxy_test.mjs`: 12/12 · `node deploy/pro/proxy_test.mjs`: 13/13 (sin regresión).
- `node web/pro/v06/tests/agent_live_e2e.mjs` (Chromium + proxy + agente real con motor simulado): **24/24** en 3 corridas seguidas.
- Regresión del HTML autónomo: 20 pantallas × 4 tamaños (390, 768, 1366, 1920 px), 0 errores de JavaScript.
- Las pruebas Python del v0.6 (`tests/test_*.py`) no se corrieron: requieren Playwright para Python, que no está
  instalado en este entorno; su cobertura de regresión se reprodujo con Playwright de Node.

## 4. Cómo activarlo (cuando se autorice desplegar)

1. Desplegar `services/dj-agent` en la red interna (puerto 8790) con sus variables (`DJ_AGENT_DEV_TOKENS` o el IdP).
2. En el servicio del frontend, `DJ_AGENT_URL=http://<servicio-interno>:8790`.
3. Abrir la consola → «Agente DJ inteligente» → pegar el token de acceso → «Conectar agente».

## 5. Riesgos

- El token de acceso del agente se pega en la consola: es de desarrollo. Falta enlazar el login del Command
  Center con la identidad del agente antes de producción.
- La UI aplica el cambio de modo de forma optimista y lo revierte si el servidor lo rechaza (parpadeo breve).
- La prueba E2E usa el motor simulado; con el motor C++ real ya se probó el agente en la Fase 2.

## 6. Dictamen

**EN REVISIÓN.** La consola v0.6 opera el agente real a través del proxy, con verificación en el servidor.
Pendiente: despliegue (requiere autorización), login unificado y la Fase 6 (voz y móvil). La conexión del agente
a tu servidor de IA y a DeepSeek sigue pendiente de sus datos.
