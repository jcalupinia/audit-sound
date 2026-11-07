# 02 · Qwen local (Audi Brain Runner) y DeepSeek API

## 1. Lo verificado en código (repositorio `auditbrain-python-runner`)

| Elemento | Evidencia | Valor |
|---|---|---|
| Protocolo local | `backend/app/chat/providers.py:224-240` | Gateway **LiteLLM compatible con OpenAI**; `LOCAL_LLM_BASE_URL` debe terminar en `/v1` y se le concatena `/chat/completions` |
| Clave local | `providers.py:233-235` | `LOCAL_LLM_API_KEY` (puede ir vacía) |
| Modelo local | `providers.py:238-240` | `LOCAL_LLM_MODEL`, nombre **lógico** (default `auditia-rutina`) |
| Familia del modelo | `backend/app/aud/niif/ciclo/extraccion_ia.py:56` | comentario: "modelo local (Qwen3/gpt-oss)" |
| Timeouts / contexto | `providers.py:249-282` | `LOCAL_LLM_TIMEOUT_SECONDS` (180), `LOCAL_LLM_CONTEXT_WINDOW` (24576) |
| Ping de salud | `providers.py:377` | sondeo en vivo del gateway |
| DeepSeek | `providers.py:199-209` | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default `deepseek-flash`) |
| Ruteo 2 niveles | `backend/app/chat/ruteo.py` | consulta → `deepseek-flash`, razonamiento → `deepseek-v4-pro`; clasificador heurístico sin llamada extra |

## 2. NO VERIFICADO (requiere datos o acceso)

- Modelo Qwen **exacto** (tamaño, cuantización) detrás del nombre lógico, y runtime real detrás de LiteLLM.
- RAM libre real del servidor de 16 GB **con todo en marcha**, CPU/GPU, latencia p50/p95 y concurrencia.
- Que el gateway sea alcanzable desde el entorno de desarrollo del agente.
- Cuotas, facturación y región de la cuenta DeepSeek; ID de modelo vigente.

## 3. Lo que necesito del responsable (sin pegar secretos en el chat)

| Dato | Para qué | Cómo dármelo |
|---|---|---|
| `LOCAL_LLM_BASE_URL` (+ `LOCAL_LLM_MODEL`) | F3 | variable de entorno del entorno de desarrollo |
| `LOCAL_LLM_API_KEY` | F3 | formulario seguro de credenciales del entorno (nunca en el chat) |
| Salida de `free -h`, `nproc`, `nvidia-smi` (si hay) y `GET /v1/models` del gateway | dimensionar | pegar la salida (no contiene secretos) |
| `DEEPSEEK_API_KEY` **de desarrollo** con tope de gasto | F4 | formulario seguro de credenciales |
| Presupuesto aceptable (USD/día y por sesión) | cuotas | indicar cifra |

## 4. Uso previsto por el router del agente

| Tarea | Ruta primaria | Respaldo |
|---|---|---|
| Órdenes frecuentes ("sube la energía", "salta", "modo automático") | **parser determinista** | — |
| Clasificar intención ambigua, normalizar a JSON | Qwen local | DeepSeek flash → determinista |
| Plan multi‑etapa ("30 min salsa, luego reguetón subiendo energía") | DeepSeek | Qwen → planner por reglas |
| Continuidad musical, transición en curso | **AutoMix + Selector** (nunca LLM) | — |

Reglas: salida **JSON tipada** y validada; el modelo solo referencia pistas por ID del catálogo;
timeout por llamada; circuit breaker por proveedor; tope de tokens y gasto por sesión/org/hora;
las llamadas salen **solo del backend** (nunca del navegador); los metadatos de pistas se pasan como
datos delimitados, no como instrucciones.
