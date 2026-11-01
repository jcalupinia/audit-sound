# deploy

Despliegue de AUDIT SOUND en **Hetzner vía Coolify** (arquitectura Opción B).

Contenedores previstos (se definen en los issues B1 y M7):

- **Icecast** — servidor de streaming; mountpoint `/stream.mp3` por TLS (issue B1).
- **Navidrome** — biblioteca Subsonic con la música del usuario (issue M2/M5).
- **engine** — el motor headless + `StreamSink` (publica a Icecast).
- **api/web** — Control API (WebSocket) + frontend (issue M5).

Reglas:
- **Secretos solo en variables de entorno de Coolify**, nunca en el repo ni en
  logs (contraseñas de Icecast, de la BD, tokens). Ver `.env.example` cuando se cree.
- TLS por Let's Encrypt (Coolify).

> Vacío por ahora (andamiaje de A1). El `docker-compose` llega en B1/M7.
