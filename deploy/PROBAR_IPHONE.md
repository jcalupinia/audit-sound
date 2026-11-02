# Probar AUDIT SOUND en iPhone

Guía fija para validar la herramienta en un iPhone (Safari). Hay **dos modos** y se
prueban distinto, porque iOS trata el audio de cada uno de forma diferente:

| Modo | Qué es | ¿Pantalla bloqueada? | Dónde vive |
|---|---|---|---|
| **Mezclador PRO** | DJ interactivo en el navegador (manual / asistido / automático) | ❌ No (iOS pausa Web Audio al bloquear) | `sound.audit-ia.ec` (Application · `deploy/pro/Dockerfile`) |
| **Escuchar (Modo C)** | El DJ suena en el servidor y el iPhone reproduce el stream | ✅ **Sí**, con controles en la pantalla de bloqueo | `audit-sound.audit-ia.ec` (Docker Compose · `deploy/docker-compose.yml`) |

> **Requisito común: HTTPS.** El motor del mezclador necesita un contexto seguro
> (`crossOriginIsolated`), e iOS solo reproduce en segundo plano desde una página HTTPS.
> En `localhost` funciona sin HTTPS; desde el iPhone, **no**. El TLS lo emite Coolify
> (Traefik + Let's Encrypt) en cuanto el dominio resuelva al servidor.

> **Honestidad:** las URLs reales las ves en Coolify tras desplegar. No las inventes;
> si no están, el recurso aún no existe o no terminó de desplegar.

---

## Antes de tocar el iPhone — comprobación en la computadora

Abre la URL del Preview en Chrome/Edge/Safari de escritorio:

- `https://<URL>/healthz` → **`200 ok`** (solo el Mezclador PRO).
- Abre `https://<URL>/` → debe cargar. En la consola (F12), escribe
  `self.crossOriginIsolated` → debe ser **`true`** (Mezclador PRO). Si es `false`, un
  proxy/CDN está quitando las cabeceras COOP/COEP.
- Escuchar: `https://audit-sound.audit-ia.ec/stream.mp3` debe reproducir en el escritorio.

Si esto está bien, en el iPhone funcionará.

---

## A) Mezclador PRO (primer plano) — `sound.audit-ia.ec`

1. En **Safari**, abre `https://sound.audit-ia.ec`.
2. Toca **«Iniciar motor de audio»** (iOS exige un gesto para permitir sonido).
3. **Cargar** una pista: toca «Cargar» en el Deck A → se abre **Archivos/iCloud** → elige un
   audio (MP3/WAV/FLAC/Opus). Toca **▶ PLAY**.
4. Prueba **crossfader**, EQ (**HI/MID/LOW**), **FILTRO**, **hotcues**, **loops** y los modos
   **ASISTIDO·IA** / **AUTO·IA**.
5. **Biblioteca:** en **BIBLIOTECA → «+ Añadir»** guarda una pista; recarga y comprueba que
   sigue ahí (IndexedDB persiste).

**Qué funciona y qué NO en iPhone (modo PRO):**

| Función | iPhone |
|---|---|
| Mezcla manual, EQ, crossfader, hotcues, loops, FX | ✅ Sí (en primer plano) |
| Biblioteca persistente (IndexedDB) | ✅ Sí |
| Navidrome / música libre (Jamendo) | ✅ Sí (servidor con HTTPS + CORS) |
| **Convertidor a Opus 160** | ❌ No (Safari no trae el codificador WebCodecs; el botón sale desactivado) |
| **Sonar con la pantalla bloqueada** | ❌ No → usa el modo B |

---

## B) Escuchar con **pantalla bloqueada** (Modo C) — `audit-sound.audit-ia.ec`

Este es el que resuelve el audio con la pantalla bloqueada.

1. En **Safari**, abre `https://audit-sound.audit-ia.ec`.
2. Toca **«▶ Escuchar»** → debe empezar a sonar (la demo, o tu música).
3. **Bloquea la pantalla.** El audio **debe seguir sonando**.
4. En la pantalla de bloqueo deben verse los **controles play/pausa** con el título
   «AUDIT SOUND» (eso es la Media Session). Prueba pausar/reanudar desde ahí.

Si el audio sigue con la pantalla bloqueada, el objetivo está cumplido.

**Una sola URL:** la página y el stream salen del mismo dominio
(`https://audit-sound.audit-ia.ec/stream.mp3`), así que **no hay mezcla de contenido** y el
Icecast no se expone. (Ver `deploy/COOLIFY_GUIA.md`, sección B.)

---

## Problemas frecuentes

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| El mezclador no arranca; `crossOriginIsolated` = `false` | Falta HTTPS o un proxy quita COOP/COEP | Usa la URL **HTTPS** del Preview; revisa que Traefik no reescriba cabeceras |
| En iPhone no suena el stream, o se corta al bloquear | Mezcla de contenido (página HTTPS + stream HTTP) | Con el modo de **un solo dominio** no pasa; si expones Icecast aparte, su dominio debe ser HTTPS |
| El stream va en silencio | Sin música y demo apagada | Deja `AUDIT_SOUND_DEMO=1`, o sube música a `/music` / configura Navidrome/Subsonic |
| El botón «Convertir»/«Opus» aparece gris en iPhone | Safari no soporta el codificador WebCodecs | Convierte desde Chrome/Edge en computadora |

---

## Si necesitas ayuda

En iPhone no es fácil ver la consola. Lo más rápido: dime **qué pasó** (no arranca, no carga
la pista, no suena, se corta al bloquear…) y manda una **captura**. Para depurar a fondo se
puede conectar el iPhone a un Mac (Safari → Desarrollo → Web Inspector), pero normalmente con
tu descripción + la comprobación de escritorio basta.
