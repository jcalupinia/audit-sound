# A4-08 — Archivos modificados

Rama `claude/etapa-a4-cierre`, sobre la base `b826a7e` (diagnóstico Fase 1, sobre `main`
con la Etapa A ya fusionada). Commits:

```
41efe29 A4.1: Control API — login POST, fin de ?token=, CORS deny-by-default, handshake, logout
65aba6a A4.2: buscador — licencia por pista (NC/ND), dedup por versión y cancelación de búsquedas
f434882 A4.3 + A4.5: continuidad ante archivos corruptos (con medición) y pruebas Node en CI
(+ este commit de documentación A4)
```

## Diff respecto a la base de la rama

```
 .github/workflows/ci.yml         |  13 ++   (job frontend: search_test + proxy_test)
 engine/api/control_api.cpp       | 366 ±    (S-01..S-04)
 tools/control_api_test.cpp       | 170 ±    (contrato A4, 21 asserts)
 tools/playback_recovery_test.cpp |  47 ±    (corruptos + medición de hueco)
 web/index.html                   |  42 ±    (login POST, request/approve/deny, logout)
 web/pro/archive.js               |   4 ±    (signal en fetch)
 web/pro/console.js               |  27 ±    (cancelación + licencia/restricciones en UI)
 web/pro/openmusic.js             |   4 ±    (signal en fetch)
 web/pro/search.js                | 181 ±    (licencia por pista, dedup por versión, abort)
 web/pro/search_test.mjs          |  70 +    (nuevo: unitarias del buscador)
 web/pro/subsonic.js              |   4 ±    (signal en fetch)
```

## Por función / propósito

| Archivo | Cambio principal |
|---|---|
| `engine/api/control_api.cpp` | Login POST body; token solo Bearer; CORS deny-by-default; handshake de control (request/approve/deny, take gated); logout con revocación; proxy confiable; purga/TTL |
| `tools/control_api_test.cpp` | Reescrita al contrato A4 (libcurl, 21 asserts) |
| `web/index.html` | Cliente: login por body, Solicitar/Autorizar/Rechazar control, Salir |
| `web/pro/search.js` | `classifyLicense`, `versionTag`, `dedupe` conservador, `searchAll` con `AbortSignal` + `maxTotal` |
| `web/pro/console.js` | Cancelación por epoch + AbortController; chips de licencia/restricción |
| `web/pro/{openmusic,archive,subsonic}.js` | `search()` acepta `signal` opcional |
| `web/pro/search_test.mjs` | Unitarias del buscador (18) |
| `tools/playback_recovery_test.cpp` | Archivos corruptos + medición de la mayor interrupción |
| `.github/workflows/ci.yml` | Job `frontend` (Node) con search_test + proxy_test |
| `docs/etapa_a/cierre_a4/*` | Los 10 entregables |
