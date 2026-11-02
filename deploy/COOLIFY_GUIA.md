# Guía paso a paso — Previews de AUDIT SOUND en Coolify

Dos previews, cada uno prueba una cosa distinta:

| Preview | Qué prueba | Recurso Coolify | Fuente |
|---|---|---|---|
| **A · Mezclador PRO** | DJ en el navegador (manual / asistido / automático), primer plano | **Application (Dockerfile)** | `deploy/pro/Dockerfile` |
| **B · Streaming (Modo C)** | Escucha con **pantalla bloqueada** en iPhone (DJ automático) | **Docker Compose** | `deploy/docker-compose.yml` |

> **Importante (honestidad):** no puedo crear estos recursos ni darte una URL de Preview
> verificada: el acceso a Coolify desde la sesión es de **solo lectura** y el despliegue es
> tu acción en el panel. Esta guía te lleva por cada clic; **la URL la verás en Coolify**.
> Cuando despliegues y me pases las URLs, verifico los healthchecks reales.

---

## 0) Requisitos previos (una vez)

1. **GitHub App de Coolify** instalada sobre `jcalupinia/audit-sound` (para que Coolify
   pueda clonar y, si quieres, publicar previews por PR).
   - Si no la tienes: en Coolify → *Sources* → GitHub App → instalar en el repo.
2. **DNS**: apunta los subdominios que vayas a usar al **IP del servidor Hetzner** (el
   servidor `localhost` que ya tienes en Coolify). Ejemplos:
   - `mix.audit-ia`   → Preview A (mezclador PRO)
   - `www.audit-ia`   → Preview B, servicio `web`
   - `stream.audit-ia`→ Preview B, servicio `icecast`
   - Registros `A` (o `CNAME`) → IP del servidor. El TLS lo emite Coolify (Traefik +
     Let's Encrypt) solo con que el DNS resuelva al servidor.
3. Un **proyecto** en Coolify donde crear los recursos (o usa uno existente).

---

## A) Preview del **Mezclador PRO** (Application · Dockerfile)

1. **Coolify → tu proyecto → + New Resource → Application.**
2. **Source:** GitHub (la App) → repositorio `jcalupinia/audit-sound` → rama `main`.
3. **Build Pack:** elige **Dockerfile**.
   - **Dockerfile Location:** `deploy/pro/Dockerfile`
   - **Base Directory / Build Context:** `/` (raíz del repo).
4. **Network / Port:** puerto expuesto **80**.
5. **Healthcheck:** path **`/healthz`** (método GET, espera `200`).
6. **Domains:** añade `https://mix.audit-ia` (o tu dominio). Coolify pedirá el TLS a
   Let's Encrypt automáticamente.
7. **Environment (opcional):** `LISTEN_URL = https://www.audit-ia` → enlaza la tarjeta
   **«Escuchar en vivo»** de la landing con el Preview de streaming (Preview B). Si no la
   pones, esa tarjeta queda deshabilitada.
8. **Deploy.** La primera build **compila el motor a WASM** (tarda unos minutos).

> La raíz `/` es una **landing** con dos botones: **Mezclar** (→ `/mixer.html`) y
> **Escuchar en vivo** (→ `LISTEN_URL`). Así un solo dominio es la puerta de entrada.

**Comprobar (antes del iPhone):**
- `https://mix.audit-ia/healthz` → `200 ok`.
- Abre `https://mix.audit-ia/` en el escritorio: debe cargar el mezclador. En la consola
  del navegador, `self.crossOriginIsolated` debe ser `true` (si es `false`, algún
  proxy/CDN está quitando las cabeceras COOP/COEP → ver *Problemas*).

**En el iPhone (Safari) / Android (Chrome):** abre la URL **HTTPS** → «Iniciar motor de
audio» → Cargar pista → PLAY; prueba crossfader/EQ/hotcues, o los modos **ASISTIDO·IA**
/ **AUTO·IA**. *(Recuerda: este mezclador usa Web Audio y **se pausa con la pantalla
bloqueada**; para audio con pantalla bloqueada usa el Preview B.)*

---

## B) Preview de **Streaming (Modo C)** (Docker Compose)

1. **Coolify → tu proyecto → + New Resource → Docker Compose.**
2. **Source:** GitHub (la App) → `jcalupinia/audit-sound` → rama `main`.
   - **Compose file:** `deploy/docker-compose.yml` · **Base Directory:** `/`.
3. **Environment variables** (en Coolify, nunca en el repo — plantilla en
   `deploy/.env.example`):
   ```
   ICECAST_SOURCE_PASSWORD = (una clave fuerte)
   ICECAST_ADMIN_PASSWORD  = (otra clave fuerte)
   ICECAST_HOSTNAME        = stream.audit-ia
   STREAM_URL              = https://stream.audit-ia/stream.mp3
   # Opcionales (panel de control):
   AUDIT_SOUND_API_USER    = dj
   AUDIT_SOUND_API_PASS    = (clave)
   # La demo viene activada: AUDIT_SOUND_DEMO=1 (sin tocar nada suena una demo sintética)
   ```
4. **Domains por servicio:**
   - servicio **`web`** → `https://www.audit-ia`
   - servicio **`icecast`** → `https://stream.audit-ia`
   - Coolify emite TLS para **ambos**.
5. **Deploy.** El `engine` reintenta hasta que Icecast está listo; con la demo, el stream
   suena en cuanto arranca.

**⚠️ Mezcla de contenido (clave para iOS):** una página **HTTPS** no puede reproducir un
stream **HTTP**. Por eso `STREAM_URL` debe ser `https://…` y el servicio `icecast` debe
tener su **propio dominio con TLS**. Si lo dejas en HTTP, el iPhone no reproduce.

**Comprobar:**
- `https://stream.audit-ia/stream.mp3` reproduce en un navegador de escritorio.
- `https://www.audit-ia` → **Escuchar** → suena la demo.

**En el iPhone (gate móvil de la auditoría):** abre `https://www.audit-ia` → **Escuchar**
→ **bloquea la pantalla** → el audio **sigue**, con controles en la pantalla de bloqueo
(Media Session). Eso confirma la reproducción en segundo plano.

**Usar tu música en vez de la demo:** sube tus archivos al volumen `audit_music`, o
cambia el volumen por un bind (`- /ruta/host:/music:ro`) en el compose, o configura
Navidrome/Subsonic (`AUDIT_SOUND_SUBSONIC_URL/_USER/_PASS`). Prioridad: Subsonic > `/music`
> demo.

---

## Previews automáticos por PR (opcional)

En cada Application/Compose de Coolify puedes activar **Preview Deployments**: cada Pull
Request abierto genera un entorno con su propia URL (y Coolify suele comentarla en el PR).
Requiere la GitHub App con permiso sobre el repo. Útil para probar una rama sin tocar el
Preview principal.

---

## Dónde está la URL
- **Application:** Coolify → la app → **Domains / Links**.
- **Compose:** Coolify → el recurso → cada servicio con dominio muestra su enlace.
- **Preview por PR:** en el recurso → *Preview Deployments*, y en el comentario de la
  GitHub App de Coolify en el PR.

No construyas la URL a mano a partir del nombre del servicio: tómala de ahí.

---

## Problemas frecuentes

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| `self.crossOriginIsolated` = `false` en el mezclador PRO | Un proxy/CDN quita las cabeceras COOP/COEP | Asegúrate de que Traefik no las reescribe; el `server.js` las emite, deben llegar al navegador |
| El iPhone no reproduce el stream | Mezcla de contenido (web HTTPS + stream HTTP) | `STREAM_URL` en `https://` y dominio TLS para `icecast` |
| El stream va en silencio | Sin música y demo apagada | Deja `AUDIT_SOUND_DEMO=1`, o sube música a `/music`/Subsonic |
| La build del PRO falla en la etapa WASM | Tag `emscripten/emsdk:6.0.13` no disponible | Usa el `6.0.x` más cercano en `deploy/pro/Dockerfile` |
| Icecast no arranca | Faltan `ICECAST_SOURCE_PASSWORD`/`ICECAST_ADMIN_PASSWORD` | Defínelas en las env vars del recurso |
| El build tarda / se queda sin disco | El contexto copia mucho | Es normal la 1ª vez (compila C++/WASM); reintenta si el servidor se quedó sin espacio |

---

## Resumen de 1 minuto
- **PRO** = *Application* + `deploy/pro/Dockerfile`, puerto 80, `/healthz`, 1 dominio HTTPS.
- **Streaming** = *Docker Compose* + `deploy/docker-compose.yml`, 2 dominios HTTPS (`web`,
  `icecast`), env `ICECAST_*` + `STREAM_URL`.
- Pásame las URLs cuando desplieguen y **verifico los healthchecks reales** antes de que
  pruebes en el iPhone.
