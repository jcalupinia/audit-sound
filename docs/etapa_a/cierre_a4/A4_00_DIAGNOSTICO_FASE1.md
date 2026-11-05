A4.0 — Diagnóstico Fase 1 (auditoría independiente de estado)
Repo `jcalupinia/audit-sound`, `main` (commit leído `6612458`). Lectura de código real; sin modificar código. Estados: CUMPLE · PARCIAL · NO CUMPLE · NO VERIFICADO.
A4.1 — Seguridad Control API

* S-01 credenciales/token en URL — PARCIAL. `/api/login` lee `user`/`pass` de la query string (`MHD_GET_ARGUMENT_KIND`) y descarta el cuerpo POST; `authToken()` aún acepta `?token=` además de `Authorization: Bearer`. Falta: login por POST body, eliminar `?token=` tras ventana de compatibilidad.
* S-02 CORS permisivo — NO CUMPLE. Sin `AUDIT_SOUND_API_ORIGIN`, `reply()` emite `Access-Control-Allow-Origin: *`. Falta default seguro (no comodín) y rechazo explícito de orígenes.
* S-03 transferencia de control — NO CUMPLE. `/api/control/take` asigna el controlador de forma incondicional (cualquier sesión arrebata el control). Falta política solicitar→aprobar→liberar y recuperación controlada.
* S-04 auth/rate limit — PARCIAL. Rate limit 8/5min→429, TTL 2h y comparación en tiempo constante presentes. Falta revocación de sesión server-side (hoy logout es solo cliente) y documentar la interacción con la auth del Command Center.

A4.2 — Buscador unificado (`web/pro/search.js`)

* A licencias Jamendo — NO CUMPLE. `normLibre()` fija `availability: mezclar` a todas las pistas; falta clasificar por licencia individual (BY / BY-NC / BY-ND). `archiveAvailability()` sí es conservador para Archive.
* B deduplicación — PARCIAL. `normKey` = título+artista; colapsa versiones distintas (remix/live/remaster). Falta incluir duración/álbum/versión.
* C disponibilidad/acciones — NO VERIFICADO. Acciones (deck A/B, cola, preview, guardar) en `console.js`, pendiente de relectura.
* D rendimiento — PARCIAL. Paralelo (`Promise.allSettled`) + timeout por proveedor OK; falta cancelación de búsquedas obsoletas (AbortController) y control de memoria.

A4.3 — APIs reales — PARCIAL
Jamendo (`/api/openmusic/search?q=love` → 3 pistas CC + audio) e Internet Archive (`/api/archive/search?q=piano`) verificados en vivo. Navidrome y carga real a deck: PENDIENTE DE VALIDACIÓN REAL.
A4.4 continuidad / A4.5 móvil — PARCIAL
Failover 5/5 y emulación 11/11 en CI/local. Interrupción de Icecast, larga duración, métricas y dispositivo físico: PENDIENTE DE VALIDACIÓN REAL.
A4.6 CI — PARCIAL
`ci.yml` con jobs `structure`/`build`/`wasm`. Falta confirmar ejecución en verde en Actions y añadir unitarias del buscador y prueba del proxy.
Conclusión
A4 tiene trabajo correctivo real pendiente (S-01, S-02, S-03, licencia Jamendo, dedup por versión, cancelación, revocación de sesión) más validaciones reales. La implementación de código y las pruebas requieren un entorno de build; no se realizan por navegador.
