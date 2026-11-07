# 06 · Pruebas y evidencias — Fase 1

Entorno: contenedor de desarrollo aislado · Python 3.12.3 · FastAPI 0.115.6 · Pydantic 2.10.4 ·
**motor SIMULADO** (`FakeEngine`). Ninguna prueba toca el motor real, producción ni servicios de IA.
Fecha: 2026-11-07.

## 1. Suite automatizada

```bash
cd services/dj-agent && .venv/bin/python -m pytest
```

Resultado: **125 passed in 3.38 s** · `ruff check app tests` → *All checks passed!*

| Archivo | Pruebas | Qué cubre |
|---|---:|---|
| `tests/unit/test_domain.py` | 20 | máquina de estados, RBAC, autoridad por modo, autonomía, validación de comandos, Camelot, tokens, redacción de secretos |
| `tests/unit/test_intent_es.py` | 38 | 36 instrucciones en español (precisión 100 %), plan multietapa, intento de inyección → UNKNOWN |
| `tests/unit/test_planner_and_engine.py` | 10 | plan solo con IDs del catálogo, géneros, energía, sin metadatos; simulador 1 h sin silencio, cola con prioridad y vuelta al selector |
| `tests/integration/test_sessions_rbac.py` | 7 | creación, una sesión por motor, 401/403/404, aislamiento entre organizaciones, cierre sin detener el motor |
| `tests/integration/test_modes.py` | 10 | **30 cambios de modo sin reinicio**, MANUAL observa, HÍBRIDO propone/aprueba/rechaza, AUTOMÁTICO dentro de límites |
| `tests/integration/test_commands_idempotency_lease.py` | 13 | ACK real, rechazo, efecto no observado, motor caído, plato al aire, validación, capacidad, idempotencia (incl. 12 hilos), lease |
| `tests/integration/test_ws.py` | 6 | auth por mensaje, snapshot, en vivo, reconexión con replay completo, cierres 4401/4404 |
| `tests/failover/test_continuity_recovery.py` | 5 | agente caído → motor sigue 1 h, ciclo que falla, IA caída → reglas, cola automática, recuperación tras reinicio sin reenviar |
| `tests/failover/test_model_router.py` | 7 | sin proveedores → reglas, failover Qwen→DeepSeek, salida inválida, circuit breaker, presupuesto, ruta «rules», forma de la petición |
| `tests/contract/test_control_api_adapter.py` | 8 | contrato con la Control API C++ (login por cuerpo, Bearer, parámetros en query, re-login, control ocupado, errores, cola no disponible) |
| `tests/contract/test_openapi.py` | 1 | todas las operaciones de la Fase 1 presentes en el OpenAPI derivado |

## 2. Criterios de aceptación de la autorización

| Criterio | Evidencia | Resultado |
|---|---|---|
| El servicio se ejecuta localmente | `uvicorn --factory app.main:create_app` en :8790 (proceso real) | **Cumple** |
| Las API responden según contrato | 125 pruebas + E2E en vivo + OpenAPI derivado del código | **Cumple** |
| Tres modos con estados verificables | `test_modes.py` (10) + E2E en vivo | **Cumple** |
| Operaciones duplicadas controladas | `test_idempotencia_*`, `test_concurrencia_misma_clave_una_sola_ejecucion` (12 hilos → 1 ejecución), E2E en vivo | **Cumple** |
| Simulador para probar flujos sin motor real | `FakeEngine` (1 h simulada: 20 transiciones, 0 s de silencio) | **Cumple** |
| Pruebas críticas aprobadas | 125/125 | **Cumple** |
| Documentación consistente con el código | OpenAPI generado del código; 05 revisado contra el código | **Cumple** |
| Sin defectos críticos abiertos | ver informe 10 | **Cumple** (2 hallazgos corregidos durante la fase) |

## 3. Pruebas de mutación (¿las pruebas detectan fallos reales?)

Se rompió a propósito cada garantía y se comprobó que la suite falla; luego se restauró el código.

| Mutación | Prueba que la detecta |
|---|---|
| Idempotencia desactivada (`rec = None`) | `test_concurrencia_misma_clave_una_sola_ejecucion` |
| El agente ejecuta en MANUAL | `test_autoridad_del_agente_por_modo[MANUAL-…]` |
| ACK sin verificar el estado del crossfader | `test_ok_del_motor_sin_efecto_observable_no_es_exito` |

## 4. Prueba de extremo a extremo contra el PROCESO REAL (uvicorn + REST + WebSocket)

Script de verificación ejecutado contra `http://127.0.0.1:8790` (motor simulado):

| Verificación | Resultado |
|---|---|
| Crear sesión HÍBRIDO, estado real `PLAYING` | OK |
| WebSocket real: auth por mensaje + snapshot | OK |
| «salsa durante 30 minutos, luego reguetón y sube la energía» → plan de 8 pistas reales (salsa, reggaeton) + propuesta | OK |
| Supervisor aprueba → cola enviada con ACK real, plan ACTIVO | OK |
| Doble envío con la misma `Idempotency-Key` → una sola ejecución | OK |
| Seis cambios de modo en el proceso real | OK |
| Reconexión WebSocket: 15 eventos recuperados, completos y sin duplicados | OK |
| Scheduler real en AUTOMÁTICO sin plan → plan de 6 pistas creado por `dj-agent` y encolado en 2,0 s | OK |
| Salud sin secretos; 0 apariciones de tokens en el log del proceso | OK |

> **Corrección de transparencia:** la primera versión del script incluía una verificación del scheduler que
> siempre daba OK (`or True`). Se detectó al revisar la salida y se sustituyó por la prueba real de la fila
> anterior (sesión AUTOMÁTICO sin plan), que sí demuestra la acción del scheduler.

## 5. Hallazgos durante las pruebas (corregidos)

1. **Silencio artificial en el simulador** (1 s por cada 400 s): el crossfader saltaba al final del fundido.
   Se cambió a un fundido gradual → 1 h simulada con 0 s de silencio.
2. **uvicorn sin `websockets` no sirve el WebSocket** (las pruebas con `TestClient` no lo detectaban). Se añadió
   `websockets==14.1` a las dependencias y se verificó el WebSocket contra el proceso real.

## 6. NO VERIFICADO (fuera del alcance de la Fase 1 o sin recursos)

- Motor C++ real (Fase 2) — el adaptador solo se probó contra un transporte que reproduce su contrato.
- Qwen local y DeepSeek reales (Fases 3–4) — solo proveedores simulados / `httpx.MockTransport`.
- Imagen Docker: el daemon de Docker no está disponible en este entorno; el `Dockerfile` no se construyó.
- Rendimiento y estabilidad de larga duración del servicio (soak), dispositivos iOS/Android físicos.
- Cableado del frontend v0.6 (Fase 5).

## 7. Fase 2 — evidencias con el motor C++ real (actualización 2026-11-07)

Lo marcado como NO VERIFICADO en §6 respecto del motor real quedó cubierto en la Fase 2
(detalle en `12_FASE2_INFORME.md`):

| Prueba | Resultado | Evidencia |
|---|---|---|
| `control_api_test` (B1 metadatos, B2 cola, `set_mode_dj`) | 40 OK | binario nativo |
| `selector_test`, `playback_recovery_test`, `engine_selftest` | OK (Selector sin cambios) | binario nativo |
| `pytest` del agente | 133 pasan, 5 omitidas (requieren `DJ_AGENT_REAL_ENGINE_BIN`) | `services/dj-agent/tests` |
| Pruebas contra el binario real (`tests/real`) | 5/5 | 30 cambios de modo, cola → Selector, agente caído |
| Soak 10 min (motor + Icecast + agente AUTOMÁTICO) | 11/11 | `evidencias/soak_fase2_10min.json` |
| Soak 1 h 55 min | 11/11 | `evidencias/soak_fase2_2h.json` |
| Soak 15 min tras la corrección | 11/11, cola de vuelta en la 1.ª transición | `evidencias/soak_fase2_15min_correccion.json` |
| Soak 4 h continuas | **NO VERIFICADO** en este entorno | ver informe 12 §2 |

Hallazgo del soak de 2 h (corregido): tras el reinicio del agente el plan viejo seguía ACTIVO y la pista al
aire (elegida por el Selector durante la caída) no estaba en él, así que el agente no volvía a encolar hasta que
por azar sonaba una pista del plan (≈5 min). Ahora detecta el plan desfasado (pista al aire fuera del plan y
cola del motor vacía) y replanifica en el siguiente ciclo. Prueba de regresión:
`tests/failover/test_continuity_recovery.py::test_tras_caida_del_agente_el_plan_desfasado_se_replanifica`.

## 8. Fase 3 — IA para interpretar órdenes (actualización 2026-11-07)

Detalle en `13_FASE3_INFORME.md`. `pytest` 212 pasan, 5 omitidas. Batería de 38 órdenes en español
(`tests/fixtures/casos_es.json`) evaluada contra Qwen real en local (`scripts/eval_intents_llm.py`):
Qwen3 1.7B 33/38 (86,8 %), 0 salidas inválidas, 0 fugas de inyección, p95 3,2 s. **NO VERIFICADO:** el gateway
LiteLLM de la firma (sin acceso a `LOCAL_LLM_*` desde este entorno).

## 9. Fase 4 — planificación con IA, cuotas y costes (actualización 2026-11-07)

Detalle en `14_FASE4_INFORME.md`. `pytest` 228 pasan, 5 omitidas. Planes con Qwen3 1.7B real: 7/8 correctos,
todas las pistas del catálogo (`evidencias/eval_fase4_planes_qwen3_1.7b.json`). **NO VERIFICADO:** DeepSeek real.
