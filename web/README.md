# web

Frontend de AUDIT SOUND (www.audit-ia).

- **M1:** página mínima de prueba con `<audio src=".../stream.mp3" controls autoplay
  playsinline>` + botón "Escuchar" (gesto requerido por iOS) + **Media Session API**
  (controles de pantalla de bloqueo). Sirve para validar el background-audio en
  iPhone (Safari/WebKit) y Android (Chrome). Issues E1/E2.
- **M5:** frontend real (login, now-playing, waveform, cola, perilla de energía,
  play/skip) sobre el Control API (WebSocket).

> Vacío por ahora (andamiaje de A1).
