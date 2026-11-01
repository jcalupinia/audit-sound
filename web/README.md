# web

Frontend de AUDIT SOUND (www.audit-ia).

- **E1 (hecho):** `index.html` — página mínima autónoma (sin dependencias externas)
  con botón **"Escuchar"** (gesto requerido por iOS), un `<audio playsinline>` que
  reproduce el stream MP3 de Icecast, e indicadores de estado (En vivo / Conectando
  / Error). La URL del stream se pasa con `?stream=...` o por defecto
  `<origin>/stream.mp3`. En producción apunta al Icecast de Coolify.
  Verificado en Chromium/Blink (equivalente a Android Chrome) con
  `tools/web_playback_check.js`.
- **E2 (hecho):** Media Session API — metadatos (título, artista "AUDIT SOUND",
  carátula SVG inline) + `playbackState` + handlers play/pause/stop, para mostrar
  información y controles en la pantalla de bloqueo / notificación. Verificado en
  Chromium con `tools/web_playback_check.js` (metadata + playbackState poblados).
- **M5:** frontend real (login, now-playing, waveform, cola, perilla de energía,
  play/skip) sobre el Control API (WebSocket).

## Probar localmente

```bash
# con un Icecast local en :8900 y el motor transmitiendo (ver README raíz):
cd web && python3 -m http.server 8080
# abrir http://localhost:8080/index.html?stream=http://localhost:8900/stream.mp3
```
