# AUDIT SOUND · Agente DJ (`services/dj-agent`) — Fase 1

Servicio **aislado del motor de audio**: recibe instrucciones, decide según el modo
(MANUAL / HÍBRIDO / AUTOMÁTICO) y la política, y envía **comandos validados** al motor.
El agente **nunca produce ni mezcla audio** y **no es necesario para que el motor siga sonando**:
si el agente cae, el motor C++ y su AutoMix continúan.

> **Estado: Fase 1 — LISTO PARA REVISIÓN.** Funciona con el **motor SIMULADO** y reglas
> deterministas. No hay integración real con el motor C++, Qwen ni DeepSeek (Fases 2–4).
> No está desplegado en ningún entorno.

## Requisitos
- Python 3.12+
- Sin servicios externos obligatorios (SQLite local, motor simulado, IA desactivada por defecto).

## Instalación

```bash
cd services/dj-agent
python3.12 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

## Ejecución local

```bash
DJ_AGENT_DEV_TOKENS="dev-op:ana:operator:org1;dev-sup:sofia:supervisor:org1" \
  .venv/bin/uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8790
```

- Documentación interactiva (OpenAPI): <http://127.0.0.1:8790/docs>
- Salud: `GET /api/v1/dj-agent/health`

Prueba rápida:

```bash
curl -s -X POST localhost:8790/api/v1/dj-agent/sessions -H "Authorization: Bearer dev-op" \
     -H "Content-Type: application/json" -d '{"name":"Prueba","mode":"HIBRIDO"}'
```

## Pruebas

```bash
.venv/bin/python -m pytest          # 125 pruebas: unitarias, integración, contrato, failover
.venv/bin/ruff check app tests
.venv/bin/python scripts/export_openapi.py   # regenera docs/dj-agent/03_CONTRATOS_API_OPENAPI.yaml
```

## Estructura

```
app/
  main.py                    fábrica de la app (lifespan: recuperación + scheduler)
  api/deps.py                principal autenticado, correlación
  api/v1/routes.py           REST /api/v1/dj-agent/...
  api/v1/ws.py               WebSocket de eventos (snapshot + replay + en vivo)
  core/{settings,security,errors,logging}.py
  domain/models.py           estados, modos, roles, esquemas, máquina de estados
  domain/policies.py         RBAC por operación + autoridad del agente por modo/autonomía
  domain/commands.py         lista blanca de comandos del motor y validación de rangos
  domain/music.py            Camelot (misma codificación que el motor)
  orchestration/session_manager.py   orquestador (sesiones, modos, control, comandos, propuestas, planes)
  orchestration/intent.py    intérprete determinista en español
  orchestration/planner.py   planificador musical (solo pistas del catálogo)
  orchestration/model_router.py      router Qwen/DeepSeek (circuit breaker, presupuesto, respaldo)
  adapters/engine_base.py    contrato del motor + verificación del efecto (ACK real)
  adapters/engine_fake.py    motor SIMULADO (reloj virtual, AutoMix propio, cola de Fase 2)
  adapters/engine_control_api.py     adaptador al motor C++ real (contrato verificado; prueba real en Fase 2)
  adapters/llm.py            proveedor compatible con OpenAI (LiteLLM local / DeepSeek)
  persistence/store.py       SQLite: sesiones, comandos, idempotencia, propuestas, planes, eventos, consumo
  events/bus.py              eventos con secuencia por sesión (auditoría + tiempo real)
  workers/scheduler.py       ciclo periódico (nunca propaga errores)
```

## Variables de entorno
Ver `.env.example` (solo nombres; **nunca** secretos en el repositorio). Las de IA usan las mismas
convenciones que el Audi Brain Runner (`LOCAL_LLM_*`, `DEEPSEEK_*`); sin ellas, el agente opera solo con reglas.

## Documentación
`docs/dj-agent/`: diagnóstico (00), arquitectura (01), IA (02), OpenAPI (03), matriz del v0.6 (04),
estados y políticas (05), pruebas y evidencias (06), informe de auditoría de la Fase 1 (10) y
propuesta de la Fase 2 para el motor (11).
