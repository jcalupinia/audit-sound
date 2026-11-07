# 14 · Fase 4 — Informe de entrega (DeepSeek + planificador asistido + cuotas y costes)

> **Estado:** en revisión. Rama `claude/dj-agent-fase4`. Sin despliegue ni cambios en producción.
> **DeepSeek real: NO VERIFICADO.** El dueño rechazó el formulario de la clave en esta sesión; DeepSeek se probó
> con transporte simulado. La planificación con un modelo real se probó con Qwen3 1.7B local (el respaldo previsto).

## 1. Alcance entregado

| Elemento | Estado | Evidencia |
|---|---|---|
| Planificación multi-etapa con IA: el modelo propone la ESTRUCTURA (bloques de género, minutos, energía) | **REAL** | `app/orchestration/llm_plan.py` |
| Las pistas las elige el planificador determinista, solo por ID del catálogo | **REAL** | `test_plan_multietapa_con_deepseek_usa_solo_pistas_del_catalogo` |
| Al modelo no se le envían títulos ni artistas (resumen numérico por género) | **REAL** | `test_resumen_del_catalogo_no_incluye_titulos` |
| Saneado del plan: géneros existentes en el catálogo, 1–240 min por bloque, ≤ 8 bloques, ≤ 480 min | **REAL** | `test_llm_plan.py` |
| Energía por bloque (sube en un tramo, baja en otro) | **REAL** | `test_planificador_respeta_la_energia_de_cada_bloque` |
| Orden de respaldo: DeepSeek → Qwen → planificador por reglas | **REAL** (simulado y con Qwen real) | pruebas + corrida de extremo a extremo |
| Cuotas: llamadas por hora por organización (120) y por sesión (30) | **REAL** | `test_cuota_de_llamadas_por_hora_…` |
| Presupuesto USD día/org y sesión con estimación PREVIA de la llamada | **REAL** | `test_una_llamada_que_superaria_el_presupuesto_no_se_hace` |
| Tarifas DeepSeek configurables (`DJ_AGENT_DEEPSEEK_USD_PER_MTOK_IN/OUT`), rotuladas como estimación | **REAL** | `/usage` |
| `/usage`: restante del día, llamadas en la hora, totales por proveedor | **REAL** | `test_consumo_informa_restante_y_por_proveedor` |
| DeepSeek sin saldo (HTTP 402) → error del proveedor, circuit breaker y respaldo | **REAL** (simulado) | `test_deepseek_sin_saldo_402_…` |
| Tiempo límite propio para planes (20 s; órdenes 8 s) | **REAL** | `test_los_planes_tienen_su_propio_tiempo_limite` |
| Llamada real a la API de DeepSeek, ID de modelo vigente y tarifas reales | **NO VERIFICADO** | sin clave de desarrollo |

## 2. Resultados con un modelo real (Qwen3 1.7B local, CPU de 4 núcleos)

Evaluador `scripts/eval_planes_llm.py` (8 pedidos de set): **7/8** planes correctos, 0 salidas inválidas, todas las
pistas del catálogo. Latencia p50 10,2 s, máx. 13,6 s. Evidencia: `evidencias/eval_fase4_planes_qwen3_1.7b.json`.

- Fallo: «deep house que vaya bajando para cerrar» → el modelo agregó un bloque de pop subiendo.
- «bachata y luego salsa» (bachata no está en el catálogo) → eligió house en lugar del género más parecido.
- **Hallazgo corregido:** con el tiempo límite de 8 s la mayoría de los planes de Qwen local habría caído por
  tiempo; los planes tienen ahora su propio límite (20 s). La música no espera: sigue sonando con AutoMix.

Prueba de extremo a extremo (HTTP → agente → Qwen3 real → motor simulado): «arranca suave con lounge… termina con
techno» → plan de Qwen (DeepSeek no configurado) lounge ×3 → techno ×2 ejecutado; `/usage` registró 2 llamadas,
1.333 tokens de entrada, coste 0.

## 2b. Planes con el gateway real de la firma (`auditia-rutina`)

`scripts/eval_planes_llm.py` corrido por el dueño desde su tailnet: **8/8 planes correctos**, todas las pistas del
catálogo, p50 2,5 s, máx. 3,1 s (`evidencias/eval_gateway_real_planes.json`). Mejor que Qwen3 1.7B local (7/8,
p50 10,2 s). DeepSeek real sigue **NO VERIFICADO** (falta el secreto de red en el entorno de pruebas).

## 3. Pruebas ejecutadas

- `pytest`: 228 pasan, 5 omitidas (requieren `DJ_AGENT_REAL_ENGINE_BIN`). `ruff`: limpio.
- Se ajustó una prueba por cambio intencional: el presupuesto ahora cuenta el coste estimado ANTES de llamar
  (antes podía pasarse por una llamada).

## 4. Cómo cerrar lo NO VERIFICADO (DeepSeek)

Con una clave de **desarrollo** con tope de gasto (cargada en los secretos de red del entorno, nunca en el chat):

```bash
LLM_BASE_URL=https://api.deepseek.com/v1 LLM_MODEL=deepseek-flash LLM_API_KEY=<clave de desarrollo> \
  python scripts/eval_planes_llm.py --reporte eval_planes_deepseek.json
```

Confirmar además el ID de modelo vigente y las tarifas reales de la cuenta, y ajustar
`DJ_AGENT_DEEPSEEK_USD_PER_MTOK_IN/OUT`.

## 5. Riesgos

- Las tarifas son estimaciones configuradas; `/usage` no es facturación real.
- Cuotas y presupuesto viven en la base local del agente (una instancia); con varias instancias habría que
  centralizarlas.
- Planes con Qwen local tardan 6–14 s en CPU; aceptable porque el audio no espera, pero la respuesta al usuario sí.

## 6. Dictamen

**EN REVISIÓN.** Planificador asistido, cuotas y costes hechos y probados (DeepSeek simulado, Qwen real).
DeepSeek real queda **NO VERIFICADO**. La Fase 5 (cableado del frontend v0.6) no se inicia sin autorización.
