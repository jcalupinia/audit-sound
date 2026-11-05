# A4-07 — Matriz de cumplimiento de la Etapa A

Cada requisito ↔ archivos modificados ↔ pruebas ↔ resultado ↔ riesgo pendiente.
Estados: ✅ hecho y probado · 🟡 hecho, validación externa pendiente · ⛔ no ejecutable aquí.

## A4.1 — Seguridad Control API

| Req | Archivos | Prueba | Resultado | Riesgo |
|---|---|---|---|---|
| S-01 login POST + sin `?token=` | `control_api.cpp`, `web/index.html` | `control_api_test` | ✅ 21/21 | login creds en body (ok); nginx sin cambios |
| S-02 CORS deny-by-default | `control_api.cpp` | `control_api_test` | ✅ | definir `AUDIT_SOUND_API_ORIGIN` en deploy |
| S-03 transferencia con autorización | `control_api.cpp`, `web/index.html` | `control_api_test` | ✅ | — |
| S-04 logout/revocación, TTL, proxy | `control_api.cpp` | `control_api_test` | ✅ | — |

## A4.2 — Buscador unificado

| Req | Archivos | Prueba | Resultado | Riesgo |
|---|---|---|---|---|
| Licencia por pista (NC/ND) | `search.js`, `console.js` | `search_test.mjs`, E2E | ✅ 18/18 + 6/6 | criterio NC en eventos comerciales = decisión del auditor |
| Dedup por versión/álbum/duración | `search.js` | `search_test.mjs` | ✅ | — |
| Cancelación (AbortController) | `search.js`, `console.js`, `{openmusic,archive,subsonic}.js` | `search_test.mjs` | ✅ | — |
| Integración con decks/cola/modos | `console.js` | E2E Playwright | ✅ | — |
| No bloquea el audio | `console.js` | E2E (pos avanza) | ✅ | — |

## A4.3 — Continuidad del motor

| Req | Archivos | Prueba | Resultado | Riesgo |
|---|---|---|---|---|
| Recuperación (ausentes + corruptos) | `playback_recovery_test.cpp` | CI | ✅ 7/7, 0 ms de corte | — |
| Reconexión Icecast | — | — | ⛔ requiere Icecast | prueba de integración pendiente |
| Memoria en larga duración | — | — | ⛔ requiere ejecución larga | medición pendiente |

## A4.4 — Compatibilidad y frontend

| Req | Prueba | Resultado | Riesgo |
|---|---|---|---|
| Modos/Vistas/Fuentes coherentes | E2E + revisión | ✅ | — |
| Guard de capacidades móvil | emulación 11/11 | ✅ | — |
| Dispositivo físico | — | ⛔ manual | iPhone/Android reales |

## A4.5 — CI

| Req | Resultado |
|---|---|
| Jobs C++/WASM/frontend con las pruebas listadas | ✅ (ver A4-06); resultado de GitHub Actions a confirmar en el PR |

## Validaciones externas (categoría aparte)

| Validación | Estado |
|---|---|
| APIs reales Jamendo/Archive | 🟡 proxy con mock ✅; real pendiente (clave+red) |
| Navidrome real | ⛔ requiere instancia de prueba autorizada |
| iPhone/Android físico | ⛔ manual |
| Icecast reconnect / larga duración | ⛔ requiere infraestructura |

**Sin fallos críticos o altos abiertos** en lo implementado (seguridad, buscador, motor).
Lo pendiente son validaciones externas/físicas, no defectos del código.
