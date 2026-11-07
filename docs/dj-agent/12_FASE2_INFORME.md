# 12 · Fase 2 — Informe de entrega (motor C++ real)

> **Estado:** en verificación final — falta el resultado del soak de 4 h (en curso). Rama `claude/dj-agent-fase2`,
> PR borrador jcalupinia/audit-sound#52. Sin despliegue ni cambios en producción.

## 1. Alcance entregado

| Elemento | Estado | Evidencia |
|---|---|---|
| B1 · metadatos en `/api/tracks` (BPM, tono, energía, duración) | **REAL** | `control_api_test` (B1 ×4); BPM analizados del binario = BPM generados (124,124,126,128,122,120,130,126) |
| B2 · cola del agente con prioridad sobre el Selector y vuelta automática | **REAL** | `control_api_test` (B2 ×15); `test_real_engine` (cola → Selector) |
| Algoritmo del Selector / AutoMix | **SIN CAMBIOS** | `selector_test` OK; la cola es un envoltorio del callback |
| `set_mode_dj`: crossfader y bug de recarga del plato al aire | **REAL (corregido)** | 30 cambios de modo con el motor real sin corte ni recarga |
| Adaptador del agente contra el binario | **REAL** | 5/5 pruebas `tests/real` en tres corridas seguidas |
| Recuperación tras caída del agente (token persistido, `logout`, reintento de `take`) | **REAL** | soak 10 min: sesión recuperada + comando ACKNOWLEDGED tras `kill -9` |
| Agente detenido → el audio sigue | **REAL** | soak 10 min: 90 s sin agente, oyente Icecast sin huecos (máx. 0,32 s) |
| Soak 4 h en AUTOMÁTICO | **EN CURSO** | `scripts/soak_agente_fase2.py`, DUR=14400 |
| Qwen / DeepSeek | **NO CONECTADO** (Fases 3–4) | IA desactivada por defecto |

## 2. Pruebas ejecutadas

- Nativas: `control_api_test` 40 OK · `selector_test` OK · `playback_recovery_test` 7 OK · `engine_selftest` OK.
- Agente: `pytest` 132 pasan, 5 omitidas (las del binario real sin `DJ_AGENT_REAL_ENGINE_BIN`); con la variable, 5/5.
- `ruff check app tests`: limpio.
- CI de GitHub en el PR #52: 8/8 checks en verde (estructura, frontend, motor Linux + selftest, WASM).

### Soak de validación de 10 min (motor real + Icecast + agente en AUTOMÁTICO)

Evidencia: `docs/dj-agent/evidencias/soak_fase2_10min.json`. 11/11 criterios OK:
motor sin caídas · stream sin cortes (hueco máx. 0,32 s) · sin silencios en las muestras · 11 transiciones
(mínimo 7) · 11 pistas tomadas de la cola del agente · sin agente el AutoMix siguió y el audio siguió ·
el agente reiniciado recupera la sesión, comanda el motor y retoma la cola · memoria del motor estable
(RSS 119 → 126 MB).

## 3. Hallazgos y desviaciones

Ver `11_PROPUESTA_FASE2_MOTOR.md` §8: bug grave previo de `set_mode_dj` corregido; la cola entra como mucho una
pista después de la precargada; control tras reinicio resuelto en el agente sin tocar el C++; el Selector no
conoce las pistas que encola el agente (limitación documentada).

## 4. Riesgos

- La cola y el semáforo del agente asumen **una sola instancia** del motor por agente.
- El soak usa pistas sintéticas de 60 s; con la biblioteca real (pistas de 3–6 min) hay menos transiciones por hora.
- Sin prueba con red real entre servicios (todo en `127.0.0.1`).

## 5. Dictamen

Pendiente del soak de 4 h. Si sus criterios salen OK: **LISTO PARA REVISIÓN**. La Fase 3 no se inicia sin
autorización.
