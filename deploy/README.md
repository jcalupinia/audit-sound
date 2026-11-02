# deploy — AUDIT SOUND en Coolify (Hetzner)

Despliegue de la arquitectura **Opción B**: el DJ autónomo corre en el servidor,
emite un stream MP3 por **Icecast**, y la **web** lo reproduce en el navegador.

## Servicios (`docker-compose.yml`)

| Servicio | Qué hace | Dominio en Coolify |
|---|---|---|
| `icecast` | Servidor de stream (mountpoint `/stream.mp3`) | p.ej. `stream.audit-ia` |
| `engine`  | Motor/DJ: reproduce `/music` en bucle y publica el MP3 a Icecast | — (interno) |
| `web`     | Página (nginx) que reproduce el stream | p.ej. `www.audit-ia` |

> El `engine` de hoy es un reproductor **secuencial** (placeholder). El encadenado
> inteligente con transiciones (AutoMix, M3) y el selector (M4) lo sustituyen luego,
> sin tocar Icecast ni la web.

## Pasos en Coolify

1. **Nuevo recurso → Docker Compose**, apuntando a `deploy/docker-compose.yml`
   (contexto de build = raíz del repo).
2. **Variables de entorno** (desde `deploy/.env.example`, valores reales en Coolify,
   nunca en el repo): `ICECAST_SOURCE_PASSWORD`, `ICECAST_ADMIN_PASSWORD`,
   `ICECAST_HOSTNAME`, `STREAM_URL`, `MUSIC_DIR`.
3. **Dominios**: asignar `www.audit-ia` → servicio `web`; `stream.audit-ia` →
   servicio `icecast`. Coolify pone el proxy y el **TLS (Let's Encrypt)**.
4. **Música**: montar tu biblioteca en el host (`MUSIC_DIR`) → el `engine` la ve en
   `/music` (solo lectura). *(Más adelante, Navidrome/Subsonic como catálogo.)*
5. **Desplegar.** El `engine` reintenta hasta que Icecast está listo.

## Verificar (gate de M1)

- `https://stream.audit-ia/stream.mp3` reproduce en un navegador de escritorio.
- Abrir `https://www.audit-ia` → **Escuchar** → suena.
- **En iPhone (Safari/WebKit) y Android (Chrome): bloquear la pantalla** y confirmar
  que el audio sigue, con controles en la pantalla de bloqueo (Media Session).
  Este es el criterio que retira el riesgo R1.

## Prueba local sin Coolify

Descomentar los `ports:` de `icecast` (8000) y `web` (8080) en el compose y:

```bash
cd deploy
export ICECAST_SOURCE_PASSWORD=dev-src ICECAST_ADMIN_PASSWORD=dev-adm
export ICECAST_HOSTNAME=localhost STREAM_URL=http://localhost:8000/stream.mp3
export MUSIC_DIR=/ruta/a/musica
docker compose up --build
# web en http://localhost:8080  ·  stream en http://localhost:8000/stream.mp3
```

## Notas de seguridad

- Contraseñas y claves **solo** en variables de entorno de Coolify.
- El `engine` se conecta a `icecast` por la **red interna** de compose (no expone la
  clave de fuente a Internet). Al público solo se le sirve el stream y la web, por TLS.
