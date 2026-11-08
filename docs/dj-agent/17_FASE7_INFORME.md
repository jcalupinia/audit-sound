# 17 · Fase 7: informe de entrega (endurecimiento, estabilidad, runbook y candidato de despliegue)

> **Estado:** CERRADA EN PRODUCCIÓN (2026-11-08). Fusionada (PR 61) y desplegada por el dueño con `DJ_AGENT_CC_API` y
> `DJ_AGENT_CC_ROLES` cargadas en Coolify. Verificación con la cuenta real en §7.

## 1. Alcance entregado

| Elemento | Estado | Evidencia |
|---|---|---|
| **Login unificado**: el agente valida la sesión AUDIT-IA contra `GET /apps/auth/me` del Command Center | **REAL** (CC simulado) | `test_login_command_center.py` (7) |
| Requisitos de la cuenta: app «audit_sound», sin clave pendiente de cambio | **REAL** | pruebas unitarias |
| Rol por correo (`DJ_AGENT_CC_ROLES`). Quien no figura entra como oyente. Nadie recibe el rol interno del agente | **REAL** | pruebas unitarias + E2E |
| Caché del token: 60 s si es válido, 10 s si se rechaza. Una caída del CC no se cachea y nadie entra con sesión | **REAL** | pruebas unitarias |
| Llaves de respaldo (`DJ_AGENT_DEV_TOKENS`) siguen funcionando en cadena | **REAL** | pruebas unitarias |
| La consola se conecta sola con la sesión, respeta «Desconectar» al recargar y ofrece «Conectar con mi sesión AUDIT-IA» | **REAL** (Chromium) | `cc_login_e2e.mjs` 10/10 |
| Límite de peticiones por IP en el proxy del agente (`DJ_AGENT_RATE_PER_MIN`, 240): devuelve 429 con `Retry-After` | **REAL** | `agent_proxy_test.mjs` |
| La IP del cliente sale de la última entrada de `X-Forwarded-For` (la que pone el proxy de Coolify), no de la que manda el navegador | **REAL** | código y prueba |
| Dependencias: fastapi 0.115.6 → **0.162.2** (starlette 0.41.3 → 1.10.0). Se corrigen 14 avisos de seguridad; la imagen actualiza pip | **REAL** | `pip-audit` sin hallazgos |
| Manual de operación (incidentes, rollback, respaldos, rotación de llaves, vigilancia) | **REAL** | `RUNBOOK_AGENTE_DJ.md` |
| Prueba de estabilidad con motor real + Icecast + agente actualizado | **15 min OK (11/11, con caída y reinicio del agente)** · 4 h **incompleta** (el entorno se reinició a los 39 min) | §3 |
| Login unificado contra el Command Center **real** | **NO VERIFICADO** | requiere el merge y las variables en Coolify |

## 2. Pruebas ejecutadas

- `pytest` del agente (con fastapi 0.162.2): **236 pasan, 5 omitidas**. `ruff`: limpio. `pip-audit` de las
  dependencias del agente: **sin vulnerabilidades conocidas**.
- E2E en Chromium con el agente real: `cc_login_e2e` (10/10), `agent_live_e2e` (Fase 5) y `voice_mobile_e2e`
  (Fase 6): **TODO OK**, sin errores de JavaScript.
- Proxy: `agent_proxy_test.mjs` **TODO OK** (incluye el límite de peticiones) · `proxy_test.mjs` 13/13.
- Consola: `commandcenter_test` 14/14 · `commandcenter_changepw_test` 10/10 · `search_test` 18/18 ·
  `setai_test` 9/9.
- Regresión de las 20 pantallas de la v0.6 en escritorio (1440 px) y teléfono (390 px): sin errores ni
  desplazamiento horizontal.

## 3. Prueba de estabilidad

Prueba: `scripts/soak_agente_fase2.py`, con el motor C++ real, Icecast, un oyente real y el agente en AUTOMÁTICO,
usando las dependencias nuevas (fastapi 0.162.2).

| Corrida | Resultado | Evidencia |
|---|---|---|
| **4 h** (`DUR=14400`) | **INCOMPLETA: la cortó el entorno, no el agente.** El contenedor de desarrollo se reinició a los 39 min (se apaga por inactividad). Hasta ese momento: motor sin caídas, memoria estable (125 MB), hueco máximo del stream 0,29 s y 43 transiciones, todas desde la cola del agente. No llegó a la caída y el reinicio forzados del agente (previstos al 40 % y al 55 %) | `evidencias/soak_fase7_4h_parcial.log` |
| **15 min** (`DUR=900`), con `kill -9` del agente y reinicio | **OK: 11/11 criterios**. Motor sin caídas, hueco máximo 0,24 s, sin silencios, 16 transiciones (16 desde la cola del agente), memoria +2,4 %. Con el agente caído siguieron el audio y el AutoMix. Tras el reinicio recuperó la sesión, comandó el motor y retomó la cola | `evidencias/soak_fase7_15min.json` |

**Las 4 h continuas siguen sin verificar.** El entorno de desarrollo no sostiene corridas tan largas. Queda la
prueba en producción del runbook (§8): un día de poca audiencia en AUTOMÁTICO.

## 4. Qué tiene que hacer el dueño tras el merge (candidato de despliegue)

1. Ir a Coolify › compose de streaming › **Environment Variables** y agregar dos variables (no son secretas):
   - `DJ_AGENT_CC_API`: el mismo valor que `AUDIT_SOUND_CC_API` de la consola.
   - `DJ_AGENT_CC_ROLES`: su correo con `:admin`.
2. Hacer **Redeploy** del compose. Se reconstruye la imagen del agente con fastapi nuevo.
3. Hacer **Redeploy** de la consola. Esto aplica el límite de peticiones y la conexión automática.
4. Verificar:
   - `scripts/verificar_despliegue_agente.sh https://sound.audit-ia.ec` debe dar `RESULTADO: OK`.
   - En «Agente DJ» la consola debe conectarse sola, sin pegar llaves.

## 5. Riesgos

- Si el Command Center se cae, nadie entra con su sesión AUDIT-IA hasta que vuelva. Las llaves de respaldo siguen
  sirviendo, y el audio no se ve afectado.
- El salto de versión de fastapi es grande (0.115 → 0.162). Toda la suite y los E2E pasan. Si en producción aparece
  algo raro, se vuelve atrás con «Redeploy» del despliegue anterior en Coolify (runbook §5).
- El límite de peticiones se guarda en la memoria de la consola. Vale mientras haya una sola instancia.

## 5b. Verificación en producción (2026-11-08, cuenta real del dueño)

| Prueba | Resultado |
|---|---|
| `scripts/verificar_despliegue_agente.sh https://sound.audit-ia.ec` | **RESULTADO: OK** (agente, base, motor real con cola, Qwen y DeepSeek configurados) |
| Login unificado: la consola v0.6 se conecta al agente con la sesión AUDIT-IA, sin llaves | **OK** |
| Rol por correo (`jcalupinia@auditconsulting.ec:admin`): cambio a «DJ Automático 24/7» aplicado en el servidor | **OK** |
| «salta la canción» → reglas → ejecutada y confirmada por el motor | **OK** |
| «pon algo más tranquilo para la hora de la cena» → reglas → plan de 4 pistas confirmado por el motor | **OK** |
| Orden ambigua («como en una boda cuando empieza la fiesta») → **Qwen** (`auditia-rutina`, por Tailscale) → plan confirmado | **OK** (primera evidencia de Qwen real desde producción) |

Hallazgos durante la verificación (corregidos):
1. `DJ_AGENT_CC_ROLES` tenía un correo distinto al de la cuenta AUDIT-IA: el dueño entraba como oyente. Corregido en Coolify.
2. La sesión caducada (60 min) se reutilizaba sin avisar y la v0.6 tenía su propia entrada de demostración: PR 65.
3. Durante el despliegue convivieron dos contenedores (versiones mezcladas) y el botón «Ingresar» quedó sin respuesta: PR 66.
4. El mensaje del plan mostraba «Plan: 4 pistas ()» cuando el catálogo no trae géneros: ahora muestra los títulos (este PR).

## 6. Dictamen

**CERRADA EN PRODUCCIÓN.** Login unificado, endurecimiento y runbook hechos, probados y verificados con la cuenta real (§7). Queda **NO VERIFICADO** lo
siguiente:
- las pruebas en teléfonos físicos (pendiente desde la Fase 6);
- la prueba de estabilidad de 4 h continuas (ver §3: se hará en producción, runbook §8).
