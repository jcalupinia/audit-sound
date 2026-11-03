# A1.3 — Informe de seguridad del Control API (AUDIT SOUND)

Componente: `engine/api/control_api.cpp` (servidor HTTP embebido, libmicrohttpd),
expuesto por nginx en `/api/` del mismo dominio (`deploy/web/nginx.conf`).
Puerto interno 8787; **no publicado** al exterior (solo vía proxy).

## 1. Modelo del endpoint

| Ruta | Método | Auth | Autorización |
|---|---|---|---|
| `/api/login` | POST | user+pass | rate-limit por IP |
| `/api/status` | GET | token | cualquier sesión |
| `/api/tracks` | GET | token | cualquier sesión |
| `/api/command` | POST | token | **solo el controlador** (si no, 409) |
| `/api/control/take` | POST | token | toma el control (handoff M6) |
| `/api/control/release` | POST | token | suelta el control |

Una sola credenciale compartida (`AUDIT_SOUND_API_USER`/`_PASS`) emite tokens de
sesión por dispositivo; un único "controlador" acepta comandos a la vez.

## 2. Hallazgos previos (antes de esta Etapa)

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| S1 | **Token en la URL** (`?token=` en cada sondeo): se filtra por Referer y por logs de proxys intermedios. | Media-Alta | **Corregido** |
| S2 | **Sin rate limit en `/api/login`**: fuerza bruta de la clave sin traba. | Alta | **Corregido** |
| S3 | **CORS `Access-Control-Allow-Origin: *`** fijo. | Media | **Corregido** (configurable) |
| S4 | **Comparación de credenciales no constante** (`std::string ==`): canal lateral de temporización. | Baja | **Corregido** |
| S5 | TLS lo provee el proxy (engine en HTTP interno). | Informativo | OK (puerto no publicado) |
| S6 | Credencial única compartida (no por usuario). | Aceptado | Por diseño del caso de uso |

## 3. Correcciones aplicadas (commit `de7adfa`)

- **S1 — Token por cabecera `Authorization: Bearer`** (preferido), con respaldo
  retrocompatible `?token=`. El cliente de streaming (`web/index.html`) se migró a la
  cabecera: **ya no hay ningún token en la URL** (`grep` sin coincidencias).
- **S2 — Rate limit de `/api/login`:** ventana deslizante por IP, **8 intentos / 5 min**
  → `HTTP 429`. La IP real se toma de `X-Forwarded-For` (tras el proxy) o del socket.
- **S3 — CORS por allowlist:** variable `AUDIT_SOUND_API_ORIGIN` (coma-separada). Con
  valor, el engine refleja **solo** el `Origin` que coincide (y nada si no coincide →
  el navegador bloquea); sin valor se mantiene `*` (retrocompatibilidad).
- **S4 — Comparación en tiempo constante** de usuario y clave (`ctEqual`), evaluando
  ambos campos siempre.

## 4. Evidencia (prueba automatizada `tools/control_api_test.cpp`, 12/12)

```
OK   login con clave mala → 401
OK   login correcto → 200
OK   login devuelve token
OK   status con Bearer → 200
OK   status con ?token= (compat) → 200
OK   status sin token → 401
OK   status con token inválido → 401
OK   comando del controlador → 200
OK   rate limit: primeros intentos 401, luego 429 (8 x401, 4 x429)
OK   CORS refleja el Origin permitido
OK   CORS no refleja un Origin no permitido
OK   CORS: con allowlist NO se emite el comodín *
RESULTADO: 12 OK, 0 FAIL
```

La prueba se ejecuta también en CI (`.github/workflows/ci.yml`, job `build`).

## 5. Riesgos residuales / recomendaciones

- **Credenciales de `/api/login` aún en query string.** Mitigado por: rate-limit,
  `access_log off` del bloque `/api/` en nginx, y que es una sola petición (no se
  repite como el token). Recomendación futura: aceptar user/pass en cuerpo POST
  (requiere post-processor de MHD) o `Authorization: Basic`.
- **Spoofing de `X-Forwarded-For`** solo sería posible con acceso directo al engine,
  que **no está publicado** (solo nginx lo alcanza). Si algún día se publica el puerto,
  fijar el XFF de confianza en el proxy.
- **Credencial compartida:** si se requiere trazabilidad por persona, migrar a
  usuarios individuales (fuera del alcance de esta etapa).
- **`/api/control/take`** permite a cualquier sesión válida arrebatar el control: es el
  diseño de handoff (M6) con credencial compartida; aceptable para el caso de uso.

## 6. Veredicto A1.3

Sin vulnerabilidades críticas conocidas en el Control API tras el endurecimiento.
Los cuatro hallazgos accionables (S1–S4) quedan corregidos y cubiertos por prueba
automatizada en CI. Riesgos residuales documentados, de severidad baja y mitigados.
