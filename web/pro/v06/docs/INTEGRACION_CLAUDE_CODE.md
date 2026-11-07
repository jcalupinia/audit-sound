# Cableado del backend por Claude Code — contrato para AUDIT SOUND v0.6

## Protocolo de integración

Los controles existen como elementos DOM reales. El frontend emite `auditsound:command` con:

```json
{
  "name": "mixer.crossfade",
  "payload": {"position": 70},
  "correlationId": "cmd-ejemplo",
  "contract": "PUT /api/v1/mixer/crossfader",
  "mode": "mock"
}
```

**Todas las URLs listadas son propuestas.** Antes de cablear: Claude Code debe inspeccionar los endpoints reales en el repositorio, mapear los nombres y documentar incompatibilidades. No asumir que la API actual implementa estas rutas.

## Integraciones prioritarias

| Prioridad | Subsistema | Eventos | Interfaz actual | Pendiente backend |
|---|---|---|---|---|
| P0 | Motor C++ / AutoMix | transport.*, mixer.* | Decks y EQ reales en navegador | Estado servidor, DSP, sync/beatgrid, continuidad, cue separado |
| P0 | Sesión, estado, permisos | auth.*, iam.* | Login / RBAC UI demo | JWT/OIDC, permisos reales, sesiones, auditoría |
| P0 | Audio 24/7 e Icecast | stream.* | Reproductor de URL externa | Encoder servidor, canal continuo, listener status |
| P1 | DJ Agent | agent.* | Chat, políticas, modelo, aprobaciones | Qwen local, DeepSeek API, validación de acciones, costos, fallback |
| P1 | Producción VJ | video.* | Video A/B, Preview/Programa local | Compositor, encoder, programa externo, reloj AV común |
| P1 | FX DSP | fx.* | FX1/FX2, dry/wet, presets | Algoritmos DSP, patch graph, estabilidad, latencia |
| P1 | Micrófonos | mic.* | 4 canales y permiso de navegador | Drivers/dispositivos, gain, talkover DSP, cue/monitor, audio master |
| P2 | Biblioteca/catálogo | catalog.* | Ficheros locales, cola, favoritos | Navidrome/Subsonic, persistencia, permisos, ingestión |
| P2 | Eventos | event.* | Cues, horarios, escenas | Motor de escenas y control de pantallas |
| P3 | SaaS y facturación | saas.* | Usuarios demo, planes, licencias, borradores | Multi tenant, planes reales, facturación con proveedor aprobado |

## Transporte recomendado

- Canal de comandos REST autenticado con `correlationId` e idempotencia; la operación debe producir `ack` o `error`.
- Canal WebSocket para estados confiables: `state.snapshot`, `state.patch`, `agent.decision`, `stream.status`, `silence.alert`, `command.ack`, `command.error`.
- Validar los payloads en ambos extremos; no confiar en controles deshabilitados del navegador como autorización.
- Reconectar sesiones sin reiniciar el flujo de audio. El servidor es la fuente de verdad para la reproducción continua.
- Separar audio DSP de la latencia de los modelos de IA. Qwen/DeepSeek solo envían decisiones al planificador; el motor ejecuta.
- Nunca exponer credenciales de DeepSeek, Qwen, Icecast ni pagos en el navegador.
- Establecer límites de frecuencia para cambios repetidos de faders; no enviar cada pixel de movimiento si la API no lo soporta.
- Si el servidor niega un comando, revertir el estado optimista y mostrar el motivo al operador.

## Integridad del frontend

Claude Code **no debe** reemplazar la interfaz por una foto ni recrear visualmente estos controles. Debe mapear las operaciones de `contracts/event-registry.json` a sus adaptadores y sincronizar eventos. No eliminar la fotografía del encabezado IA Copiloto (recurso corporativo aprobado) ni la consola profesional.

## Pruebas de aceptación tras cablear

1. Autenticar con usuario real y verificar sesión, permisos y logout seguro.
2. Cargar pistas A/B en el motor servidor y comprobar `play`, `pause`, `cue`, `sync`, hotcues, EQ, loops, faders y crossfade con estado WebSocket.
3. Forzar fallo de Qwen y DeepSeek durante una mezcla y comprobar continuidad de audio servidor.
4. Cambiar Manual → Híbrido → Automático sin reiniciar sesión, reproducir ni duplicar pistas.
5. Ejecutar audio, micrófono, FX, VJ y Icecast en hardware y navegadores reales.
6. Confirmar preescucha independiente sin fuga al master.
7. Verificar salida de video en monitor externo y sincronía AV real, no solo CSS.
8. Validar consumo de tokens y límites de presupuesto de IA.
9. Verificar RBAC, multiempresa, licencias, aislamiento, facturación y seguridad.
10. Ejecutar Playwright, pruebas de estabilidad y pruebas de carga en el backend.

## Advertencia de licencia y contenidos

La interfaz no incluye reproducción de Spotify/YouTube Music como fuentes de mezcla. Obtener autorizaciones de audio y derechos de emisión por separado. Cualquier reutilización de Mixxx/SideDeck GPLv3 requerirá una evaluación jurídica específica antes de comercializar.
