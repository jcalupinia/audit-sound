# deploy — AUDIT SOUND en Coolify (Hetzner)

Despliegue de la arquitectura **Opción B**: el DJ autónomo corre en el servidor,
emite un stream MP3 por **Icecast**, y la **web** lo reproduce en el navegador.

## Servicios (`docker-compose.yml`)

| Servicio | Qué hace | Dominio en Coolify |
|---|---|---|
| `icecast` | Servidor de stream (mountpoint `/stream.mp3`) | p.ej. `stream.audit-ia` |
| `engine`  | Motor/DJ: reproduce `/music` en bucle y publica el MP3 a Icecast | — (interno) |
| `web`     | Página (nginx) que reproduce el stream | p.ej. `www.audit-ia` |

> El `engine` encadena las pistas con el **AutoMix** (transiciones) y el **selector
> inteligente** (armonía/BPM/energía). Si no le das música, suena un **audio de demo**
> sintético para que el Preview funcione de inmediato.

## Pasos en Coolify

1. **Nuevo recurso → Docker Compose**, apuntando a `deploy/docker-compose.yml`
   (contexto de build = raíz del repo).
2. **Variables de entorno** (desde `deploy/.env.example`, valores reales en Coolify,
   nunca en el repo): `ICECAST_SOURCE_PASSWORD`, `ICECAST_ADMIN_PASSWORD`,
   `ICECAST_HOSTNAME`, `STREAM_URL`. Para el Preview rápido con demo, no hace falta nada
   más (la demo viene activada con `AUDIT_SOUND_DEMO=1`).
3. **Dominios**: asignar `www.audit-ia` → servicio `web` **y** `stream.audit-ia` →
   servicio `icecast`. Coolify pone el proxy y el **TLS (Let's Encrypt)** en **ambos**.
4. **`STREAM_URL`** debe ser la URL **HTTPS** del Icecast: `https://<ICECAST_HOSTNAME>/stream.mp3`.
   **Mezcla de contenido:** una página HTTPS **no puede** cargar un stream HTTP (iOS lo
   bloquea). Por eso el servicio `icecast` también necesita su dominio con HTTPS.
5. **Música (opcional).** Por defecto suena la **demo**. Para usar **tu** biblioteca:
   sube tus archivos al volumen `audit_music` (o cambia el volumen por un bind
   `- /ruta/host:/music:ro` en el compose), o configura **Navidrome/Subsonic**
   (`AUDIT_SOUND_SUBSONIC_URL/_USER/_PASS`). El `entrypoint` prioriza Subsonic > `/music` > demo.
6. **Desplegar.** El `engine` reintenta hasta que Icecast está listo.

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
