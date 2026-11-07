# 10 · Informe de auditoría técnica — Fase 1 (LISTO PARA REVISIÓN)

Especificación AS-AGENT-BE-01 · Autorización de la Fase 1 del 2026-11-07 · Rama `claude/dj-agent-fase1`
(apilada sobre `claude/dj-agent-fase0`). **Sin despliegue, sin cambios en el motor C++, sin credenciales, sin merge.**

## 1. Entregables solicitados

| # | Entregable | Ubicación |
|---|---|---|
| 1 | Código fuente del servicio | `services/dj-agent/app/` |
| 2 | Arquitectura de componentes y diagramas Mermaid | `docs/dj-agent/05_…` §1–2 · `docs/dj-agent/01_ARQUITECTURA_OBJETIVO.md` |
| 3 | Contratos REST / WebSocket | `docs/dj-agent/03_CONTRATOS_API_OPENAPI.yaml` (generado del código) · `05_…` §7 |
| 4 | Máquina de estados de las sesiones | `05_…` §2 · `app/domain/models.py::SESSION_TRANSITIONS` |
| 5 | Matriz de roles y permisos | `05_…` §4 · `app/domain/policies.py::PERMISSIONS` |
| 6 | Motor simulado y casos de prueba | `app/adapters/engine_fake.py` · `services/dj-agent/tests/` |
| 7 | Instalación y ejecución | `services/dj-agent/README.md` · `.env.example` · `Dockerfile` |
| 8 | Matriz de integración con el frontend v0.6 | `docs/dj-agent/04_MAPEO_CONTROLES_FRONTEND_V06.csv` (columnas `endpoint_f1`, `estado_f1`) |
| 9 | Resultados de pruebas automatizadas | `docs/dj-agent/06_PLAN_PRUEBAS_Y_EVIDENCIAS.md` |
| 10 | Informe de auditoría técnica | este documento |
| 11 | Riesgos, limitaciones y deuda técnica | §5–6 de este documento |
| 12 | Plan propuesto para la Fase 2 | `docs/dj-agent/11_PROPUESTA_FASE2_MOTOR.md` |

## 2. Funcionalidades obligatorias de la Fase 1

| # | Requisito | Estado | Evidencia |
|---|---|---|---|
| 1 | Servicio aislado del motor | **REAL** | `services/dj-agent/` independiente; el motor no depende de él (`test_agente_caido_el_motor_sigue_sonando_y_mezclando`) |
| 2 | API REST con OpenAPI | **REAL** | 17 rutas; OpenAPI derivado del código |
| 3 | Estados por WebSocket | **REAL** | snapshot + replay + en vivo, verificado también contra el proceso real |
| 4 | Sesiones con identificador único | **REAL** | UUID; una sesión activa por motor |
| 5 | Modos MANUAL / HÍBRIDO / AUTOMÁTICO | **REAL (motor SIMULADO)** | `test_modes.py` |
| 6 | Idempotencia y no duplicación | **REAL** | 12 hilos con la misma clave → 1 ejecución |
| 7 | Roles, permisos y autorización por operación | **REAL** (autenticación de **desarrollo**) | `test_sessions_rbac.py` |
| 8 | Motor simulado | **REAL** | `FakeEngine` |
| 9 | Orquestador con interfaces para Qwen/DeepSeek | **REAL (interfaces)** · modelos **NO CONECTADOS** | `model_router.py`, `llm.py`, `test_model_router.py` |
| 10 | Eventos, auditoría y trazabilidad | **REAL** | eventos con secuencia, actor y `correlation_id`; `X-Correlation-ID` |
| 11 | Errores, estados y recuperación | **REAL** | `test_recuperacion_tras_reinicio_sin_reenviar_comandos` |
| 12 | Pruebas unitarias, integración y regresión | **REAL** | 125/125 + mutación + E2E en vivo |

Reglas de operación: MANUAL observa · HÍBRIDO propone · AUTOMÁTICO dentro de límites · cambio de modo sin reinicio
(30 cambios) · estado persistente y reconexión desde otro dispositivo · política de conflicto entre operadores
(lease + `expected_version`) → **todas verificadas con el motor simulado**.

Continuidad (requisito crítico): con el agente detenido el motor simulado sigue 1 h con 20 transiciones y 0 s de
silencio; un ciclo del agente que falla no afecta al motor; si la IA cae, las reglas siguen; los comandos en vuelo
no se duplican tras un reinicio. **No se modificó el algoritmo de AutoMix.**

## 3. Desviaciones respecto a la especificación (justificadas)

| Tema | Especificación | Implementado | Motivo |
|---|---|---|---|
| Preferencias | `GET/PUT /api/v1/dj-agent/preferences` | `…/sessions/{id}/preferences` | la política es de la sesión/evento; las de usuario/organización quedan como deuda |
| Autenticación | real con backend | interfaz `Authenticator` + tokens de **desarrollo** | no hay IdP definido; se conecta en la fase de integración |
| Persistencia | SQLAlchemy (ADR-002 inicial) | `sqlite3` estándar detrás de `Store` | menos dependencias; ADR-002 actualizado |
| Token del WebSocket | — | primer mensaje `auth` (no en la URL) | evitar que el token quede en logs de proxies |

## 4. Revisión de seguridad

Hecho: Bearer obligatorio salvo `/health` · RBAC en servidor · aislamiento por organización (404) · el rol del agente
no es autenticable · lista blanca de acciones con `extra="forbid"` y rangos · idempotencia · lease de control ·
redacción de secretos en logs y `repr` de la configuración (0 tokens en el log del proceso real) · salida de IA
validada contra esquema; el texto del usuario va delimitado como dato; el agente no tiene herramientas de shell,
URL ni infraestructura · llamadas a IA solo desde el backend.

Pendiente: limitación de tasa por endpoint · CORS para el frontend (F5) · IdP real con caducidad y rotación de
tokens · TLS lo aporta el proxy (no el proceso).

## 5. Riesgos

| Riesgo | Impacto | Mitigación / siguiente paso |
|---|---|---|
| Comportamiento del motor real distinto del simulado | alto | Fase 2 con el binario real y soak ≥4 h antes de aprobar |
| `set_mode_dj manual` fija el crossfader en 0,5 | medio | propuesta en el documento 11 §4 |
| Instancia única (cerrojos, bus y scheduler en proceso) | medio | suficiente para un motor; escalar exigiría base y bus compartidos |
| Autenticación de desarrollo | alto si se expone | no exponer el servicio hasta integrar el IdP |
| Imagen Docker no construida | bajo | construir y probar cuando haya daemon disponible |

## 6. Limitaciones y deuda técnica

1. Sin integración real con el motor C++, Qwen ni DeepSeek (Fases 2–4).
2. Memoria del agente (§4.4): preferencias de usuario/organización con consentimiento, exportación, borrado y caducidad — no implementado.
3. Planes por duración y género; la programación por **franjas horarias** no está implementada.
4. El historial para «no repetir» se toma de los eventos `track.changed` observados por el agente.
5. Catálogo en caché 30 s; los mensajes al usuario muestran códigos internos (p. ej. `hybrid_requires_approval`).
6. Advertencia de desuso de `anyio` en `TestClient` (inofensiva).
7. Frontend v0.6 sin cablear (Fase 5); voz (Fase 6).

## 7. Dictamen del auditor

**Fase 1: APROBADO CON OBSERVACIONES.** Se cumplen todos los criterios de aceptación de la autorización con
evidencia reproducible (125 pruebas, pruebas de mutación y E2E contra el proceso real). Observaciones: todo lo
descrito funciona contra el **motor simulado**; la autenticación es de desarrollo; Docker y el motor real quedan
**NO VERIFICADOS**. No hay defectos críticos abiertos (los dos hallazgos de la fase se corrigieron).

**Siguiente autorización requerida:** aprobación de la Fase 2 (contrato del documento 11 y modificación mínima del
motor C++ en entorno aislado).
