Relación de archivos modificados — Etapa A ampliada (AUDIT SOUND)
Entregable 9. Fuente autoritativa: PR #24 (A1 motor + Control API, A2 buscador), PR #25 (cierre: failover, WASM en CI, móvil, proxy) y PR #23 (fusión de la rama `claude/bold-edison-3mg4ob` a `main`, que consolida toda la Etapa A junto con el frente Command Center). Estado verificado en `main` tras el merge. `A` = añadido · `M` = modificado.
Frente A1 — Estabilización del motor y Control API

* `engine/api/control_api.cpp` (M) — Endurecimiento S1–S4: auth Bearer, rate-limit /api/login (8/5 min → 429), CORS por allowlist, comparación en tiempo constante.
* `tools/control_api_test.cpp` (A) — Prueba de seguridad del Control API (12/12).
* `tools/playback_recovery_test.cpp` (A) — A1.4 reproducción continua + recuperación ante fallos (5/5).
* `wasm/make_track_fixture.py` (A) y `wasm/CMakeLists.txt` (M) — reparan el build WASM completo.
* `CMakeLists.txt` (M) — targets de prueba.
* `.github/workflows/ci.yml` (M) — job build (selector/control_api/playback_recovery) + job wasm (emsdk 6.0.13).
* `web/index.html` (M) — token por cabecera (sin token en URL) + audio playsinline / Media Session (A1.6).

Frente A2 — Buscador musical unificado

* `web/pro/search.js` (A) — buscador unificado (paralelo, timeout, dedup, filtro, disponibilidad).
* `web/pro/console.js` (M) y `web/pro/console.html` (M) — integración del buscador + guard de capacidades móvil.
* `deploy/pro/server.js` (M) — proxy /api/openmusic/* y /api/archive/* con allowlist; genera config.js.
* `deploy/pro/proxy_test.mjs` (A) — prueba del proxy (6/6).
* Reutilizados sin modificar: `web/pro/subsonic.js`, `web/pro/openmusic.js`, `web/pro/archive.js`, `web/pro/library.js`.

Frente A3 / Front Command Center

* `web/pro/login.html` (A), `web/pro/commandcenter.js` (A), `web/pro/console.html`/`console.js` (A/M), `deploy/web/entrypoint.sh` (M), `deploy/.env.example` (M), `deploy/COOLIFY_GUIA.md` (M), `deploy/docker-compose.yml` (M).

Documentación (docs/etapa_a/)
A1_INFORME_ESTABILIZACION_MOTOR.md · A1_INFORME_SEGURIDAD_CONTROL_API.md · A1_CIERRE_FAILOVER_MOVIL_PROXY.md · AS_12_BUSQUEDA_Y_FUENTES_MUSICA.md · A2_EVIDENCIA_Y_REGRESION.md · A_MATRIZ_APIS_LICENCIAS.md · A_RELACION_ARCHIVOS.md · A_RECOMENDACION_ETAPA_A.md.
Activos y configuración (fuera de los PR)

* `web/pro/assets/dj_hero.jpg` (A) — imagen hero del login.
* Variables en Coolify (no versionadas): App A → AUDIT_SOUND_CC_API=https://api.audit-ia.ec, AUDIT_SOUND_CC_LOGIN_PATH=/api/v1/client/auth/login, AUDIT_SOUND_CC_ME_PATH=/api/v1/client/auth/me, JAMENDO_CLIENT_ID, AUDIT_SOUND_API_ORIGIN=https://sound.audit-ia.ec, LISTEN_URL. Backend auditbrain-backend → CORS_ALLOW_ORIGINS += https://sound.audit-ia.ec.
