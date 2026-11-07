# Preview del mezclador PRO en Coolify (para probar en iPhone/Android)

El mezclador PRO (`web/pro/`) es un **sitio estático** que corre el motor en el navegador
(WebAssembly). Para funcionar necesita **HTTPS** y las cabeceras de aislamiento de origen
**COOP/COEP** (sin ellas, el navegador no habilita `SharedArrayBuffer` y el motor no arranca).

Este directorio trae todo lo necesario:
- `Dockerfile` — multi-etapa: (1) compila el motor a WASM con Emscripten, (2) sirve
  `web/pro/` + el motor con un servidor estático que emite COOP/COEP y el MIME de `.wasm`.
- `server.js` — el servidor estático (sin dependencias; `/healthz` para el healthcheck).

La **raíz `/` es una landing** con dos entradas: **Mezclar** (→ `/mixer.html`, el
mezclador PRO) y **Escuchar en vivo** (→ la consola de streaming). El enlace de escucha
se configura con la variable **`LISTEN_URL`** (dominio del Preview de streaming); si no se
define, esa tarjeta queda deshabilitada. El `server.js` genera `config.js` con esa URL.

Verificado localmente (con el mismo `server.js` y el motor compilado): `/healthz`=200,
cabeceras COOP/COEP presentes, `audit_engine.wasm` servido como `application/wasm`, la
landing enlaza a `./mixer.html` y a `LISTEN_URL`, y el mezclador arranca con
`self.crossOriginIsolated === true` y **0 errores** en Chromium.

> **Importante:** no puedo crear la aplicación en Coolify ni desplegar por ti (el acceso a
> Coolify desde esta sesión es de **solo lectura**, y el despliegue es tu acción en el panel).
> Tampoco puedo darte una URL de Preview verificada hasta que la app exista. Aquí van los
> pasos exactos para crearla; **la URL la verás en Coolify** (y, con previews por PR, en el
> comentario que publica la GitHub App de Coolify en el PR).

## Crear la app en Coolify (una vez)

1. **Coolify → tu proyecto → + New Resource → Application.**
2. **Source:** GitHub (la GitHub App de Coolify) → repositorio `jcalupinia/audit-sound`.
   - Rama: `main` (o la que quieras). Para **previews por PR**, activa *Preview Deployments*
     en la app (necesita la GitHub App de Coolify con permiso sobre el repo).
3. **Build Pack: Dockerfile.**
   - *Dockerfile Location:* `deploy/pro/Dockerfile`
   - *Base Directory / Build Context:* `/` (la raíz del repo; el Dockerfile copia `wasm/`,
     `engine/`, `third_party/` y `web/pro/`).
4. **Port (puerto expuesto):** `80`.
5. **Healthcheck path:** `/healthz` (debe devolver `200 ok`).
6. **Dominio (FQDN):** asigna un dominio o subdominio. Coolify (Traefik) emite el certificado
   **HTTPS** (Let's Encrypt) automáticamente. HTTPS es **obligatorio** para que el motor WASM
   funcione en iOS/Android.
7. **Deploy.** La primera build compila el WASM (tarda unos minutos).

## Dónde está la URL
- **Producción/rama:** en la propia aplicación en Coolify → *Domains / Links*.
- **Preview por PR:** en Coolify → la app → *Preview Deployments*, y en el **comentario de la
  GitHub App de Coolify** dentro del PR.

No construyas la URL a mano a partir del nombre: tómala de ahí.

## Comprobaciones antes de probar en el móvil
- `GET https://<tu-dominio>/healthz` → `200 ok`.
- Abre `https://<tu-dominio>/` en el navegador: debe cargar el mezclador. En la consola,
  `self.crossOriginIsolated` debe ser `true` (si es `false`, faltan las cabeceras COOP/COEP:
  revisa que no haya un proxy/CDN que las quite).

## Probar en el iPhone (Safari) / Android (Chrome)
1. Abre la URL **HTTPS** del Preview.
2. Pulsa **«Iniciar motor de audio»** (gesto requerido por la política de autoplay).
3. **Cargar** una pista en un plato → **PLAY**; prueba crossfader, EQ, hotcues; o el modo
   **ASISTIDO·IA** / **AUTO·IA**.

### Límite conocido de iOS (honesto)
El mezclador PRO usa **Web Audio** (primer plano). iOS **suspende** Web Audio al **bloquear la
pantalla** o cambiar de app, así que el mezclador manual **se pausa con la pantalla bloqueada**.
La reproducción con pantalla bloqueada corresponde a la **ruta de streaming (Modo C / Opción B)**
—motor en el servidor + Icecast + `<audio>`—, que es un despliegue aparte (`deploy/` raíz). Si
quieres también ese Preview, lo preparamos por separado.

## Construir/probar la imagen localmente (opcional, requiere Docker)
```bash
# desde la raíz del repo
docker build -f deploy/pro/Dockerfile -t audit-sound-pro .
docker run --rm -p 8080:80 audit-sound-pro
# abrir http://localhost:8080/  (en localhost el navegador permite SharedArrayBuffer sin HTTPS)
```
Nota: la etapa de build usa `emscripten/emsdk:6.0.13` (debe coincidir con el `emcc` del
proyecto). Si ese tag no existiera en el registro, usa el `6.0.x` más cercano.

## Agente DJ (Fase 5): `DJ_AGENT_URL`

El servidor reenvía `/api/v1/dj-agent/*` (HTTP y el WebSocket de eventos) al servicio `services/dj-agent`
indicado en **`DJ_AGENT_URL`**, normalmente una dirección **interna** (p. ej. `http://dj-agent:8790`), para
que el agente no quede expuesto a internet y el navegador hable con el mismo origen (sin CORS).

| Variable | Default | Notas |
|---|---|---|
| `DJ_AGENT_URL` | vacía | Sin ella el proxy responde 503 y la consola v0.6 queda en modo demostración. |
| `DJ_AGENT_TIMEOUT_MS` | 30000 | Tiempo máximo de una petición al agente (los planes con IA pueden tardar). |
| `DJ_AGENT_MAX_BODY` | 65536 | Tamaño máximo del cuerpo reenviado. |

Solo se reenvían `Authorization`, `Content-Type`, `Accept`, `Idempotency-Key` y `X-Correlation-Id`
(nunca las cookies del sitio). `config.js` publica `window.AUDIT_SOUND_AGENT=true|false`, nunca la URL
interna. Prueba: `node deploy/pro/agent_proxy_test.mjs`.
