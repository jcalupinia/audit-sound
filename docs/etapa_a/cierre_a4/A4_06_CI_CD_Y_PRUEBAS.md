# A4-06 — CI/CD y pruebas

Workflow: `.github/workflows/ci.yml`. Tres jobs, todos en `ubuntu-latest`.

## Jobs y pasos

| Job | Pasos de prueba |
|---|---|
| `structure` | licencia/NOTICE, sin Oboe, motor presente |
| `build` (C++) | compila el motor nativo (Release) y ejecuta: `engine_selftest`, `selector_test`, **`control_api_test`** (seguridad), **`playback_recovery_test`** (continuidad/failover) |
| `wasm` | `setup-emsdk@6.0.13` → compila `wasm/build` completo (`audit_engine` + `audit_selftest`) y comprueba artefactos |
| `frontend` (Node 20) | **`search_test.mjs`** (buscador: licencias, dedup, cancelación) y **`proxy_test.mjs`** (proxy Jamendo/Archive con upstream simulado) |

## Cobertura de pruebas automatizadas (mapa de requisitos del encargo A4.5)

| Requisito | Prueba | Dónde |
|---|---|---|
| Compilación C++ | job `build` | CI |
| Compilación WASM | job `wasm` | CI |
| Autenticación | `control_api_test` (login body, Bearer, ?token=→401) | CI |
| Revocación de sesiones | `control_api_test` (logout revoca) | CI |
| CORS | `control_api_test` (deny-by-default + allowlist) | CI |
| Transferencia de control | `control_api_test` (request/approve, /take→409) | CI |
| Buscador musical | `search_test.mjs` (paralelo, filtro, errores) | CI |
| Licencias | `search_test.mjs` (BY/NC/ND/unknown) | CI |
| Deduplicación | `search_test.mjs` (versión/álbum/duración) | CI |
| Cancelación de búsquedas | `search_test.mjs` (AbortSignal) | CI |
| Proxy musical | `proxy_test.mjs` (normalización + seguridad) | CI |
| Reproducción continua | `playback_recovery_test` | CI |
| Recuperación ante fallos | `playback_recovery_test` (ausentes + corruptos) | CI |
| Integración con decks | E2E Playwright (local, no en CI) | sesión |
| Regresión del frontend | E2E Playwright (local, no en CI) | sesión |

## Resultado local (previo a CI)

Las 4 pruebas nativas y las 2 pruebas Node pasan localmente. El resultado **verificable**
de GitHub Actions se confirma en el PR #26 tras el push (ver A4-10 / informe final). Si un
paso no puede ejecutarse en CI, se documenta aquí y no se declara éxito.

> Nota: los E2E de Playwright (integración con decks y regresión del frontend) se ejecutan
> en la sesión con el motor WASM servido con COOP/COEP; no están en CI por requerir navegador
> + servidor de cabeceras. Sus resultados se reportan en A4-02 y A4-04.
