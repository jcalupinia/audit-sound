# A4-01 — Auditoría y corrección de seguridad (Control API)

Rama `claude/etapa-a4-cierre`. Entorno: contenedor Linux de la sesión (no producción).
Implementación REAL de código + pruebas. Archivo principal: `engine/api/control_api.cpp`;
cliente `web/index.html`; prueba `tools/control_api_test.cpp` (libcurl, **21/21 OK**).

## S-01 — Credenciales y tokens fuera de la URL

| Antes (A1.3) | Ahora (A4) |
|---|---|
| Login con `?user=&pass=` en query | **Login por cuerpo POST** (`x-www-form-urlencoded`), parseado en el engine |
| Token por Bearer **o** `?token=` (compat) | **Token solo por `Authorization: Bearer`**; `?token=` **eliminado** → responde 401 |

- `authToken()` ya no lee la query; `urlDecode()`/`formField()` parsean el cuerpo POST.
- El cliente de streaming (`web/index.html`) envía las credenciales en el cuerpo.
- Errores sin eco de la credencial (`401 credenciales inválidas`, sin devolver lo enviado).
- Evidencia: `OK S-01 login (body) correcto`, `OK S-01 ?token= en la URL → 401 (eliminado)`.

## S-02 — CORS con denegación por defecto

- Sin `AUDIT_SOUND_API_ORIGIN` **no se emite** `Access-Control-Allow-Origin` (deny).
- Con allowlist, se refleja **solo** el `Origin` coincidente (+ `Vary: Origin`).
- Opt-in de desarrollo explícito: `AUDIT_SOUND_API_CORS_ALLOW_ALL=1` → `*`.
- Evidencia: `OK S-02 sin allowlist → NO se emite ACAO`, `OK allowlist refleja/bloquea`.

## S-03 — Transferencia de control con autorización

Flujo nuevo (la reproducción no se interrumpe; solo cambia el flag de controlador):
1. Secundario `POST /api/control/request`.
2. `GET /api/status` expone `pendingRequest` al controlador.
3. Controlador `POST /api/control/approve` (transfiere) o `/deny` (rechaza).
4. Evento registrado (sin secretos).
- `POST /api/control/take` ya **no arrebata** el control si hay un controlador vivo (→ 409).
- Recuperación: si el controlador se desconecta, su sesión caduca por TTL y el control
  queda libre (un `request` entonces se concede directo).
- Evidencia: `OK S-03 B /take con controlador activo → 409`, `B solicita → requested`,
  `A ve pendingRequest=B`, `A aprueba → B controla`, `A dejó de controlar → 409`.

## S-04 — Gestión de sesiones

- `POST /api/logout`: **revoca** el token server-side (se borra del mapa) → reuso = 401.
- Caducidad por TTL (purga en cada petición → recupera control si el principal cayó).
- Rate limit de login por IP (8/5 min → 429).
- Cabecera de proxy confiable configurable: `AUDIT_SOUND_API_TRUST_PROXY=false` ignora
  `X-Forwarded-For` (anti-spoofing si el engine queda expuesto).
- Evidencia: `OK S-04 logout → 200`, `token revocado tras logout → 401`, `rate limit`,
  y sesiones simultáneas A/B en la prueba S-03.

## Nota sobre nginx (`deploy/web/nginx.conf`)

El bloque `/api/` ya proxya el cuerpo POST y la cabecera `Authorization` (nginx no las
elimina) y mantiene `access_log off`. Como las credenciales y el token ya **no** viajan
en la URL, los logs no pueden filtrarlos. No requiere cambios funcionales.

## Resultado

`tools/control_api_test.cpp`: **21 OK, 0 FAIL**. Sin hallazgos de severidad alta/crítica
abiertos en el Control API tras la corrección.
