# Manual de operación del Agente DJ (runbook)

> Para el dueño y quien opere AUDIT SOUND en producción (Coolify/Hetzner). Escrito para personas que **no son de
> sistemas**: cada paso dice dónde hacer clic y qué debe verse. Regla de oro: **el audio nunca depende del agente**.
> Si algo del agente falla, el motor sigue sonando con AutoMix.

## 1. Las piezas

| Pieza | Dónde vive en Coolify | Qué hace | Si se cae… |
|---|---|---|---|
| Consola `sound.audit-ia.ec` | Application de la consola (`deploy/pro/Dockerfile`) | Pantallas v0.6; reenvía `/api/v1/dj-agent/*` al agente | No hay pantallas; el stream sigue |
| Motor `engine` | Docker Compose de streaming | Reproduce y mezcla; envía a Icecast | **Se corta el audio** (prioridad máxima) |
| Icecast `icecast` | Docker Compose de streaming | Sirve el stream a los oyentes | Se corta para los oyentes |
| Agente `dj-agent` | Docker Compose de streaming (sin dominio público) | Entiende órdenes, planifica, opera el motor | La consola pasa a modo demostración; **el audio sigue** |
| Qwen (`auditia-rutina`) | Servidor de IA de la firma, por Tailscale | Interpreta órdenes (primera opción) | El agente usa DeepSeek o reglas |
| DeepSeek | Internet | Planes y respaldo de órdenes | El agente usa Qwen o reglas |

## 2. Revisión diaria (2 minutos)

1. Desde cualquier equipo con terminal:
   ```bash
   scripts/verificar_despliegue_agente.sh https://sound.audit-ia.ec
   ```
   Debe terminar en `RESULTADO: OK`. No pide credenciales.
2. En el navegador: `https://sound.audit-ia.ec/v06/` → entrar con la cuenta AUDIT-IA → «Agente DJ inteligente».
   Debe decir **EVENTOS EN VIVO** sin pegar ninguna llave (login unificado, Fase 7).
3. Abrir el stream y escuchar 10 segundos.

## 3. Variables (dónde se configura cada cosa)

**Docker Compose de streaming › Environment Variables** (servicio `dj-agent`):

| Variable | Valor | ¿Secreta? |
|---|---|---|
| `DJ_AGENT_CC_API` | El mismo valor que `AUDIT_SOUND_CC_API` de la consola | No |
| `DJ_AGENT_CC_ROLES` | `correo-del-dueno:admin;correo-operador:operator` (quien no figure entra como oyente) | No |
| `DJ_AGENT_DEV_TOKENS` | Llaves de respaldo `token:usuario:rol:auditconsulting;…` | **Sí** |
| `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_MODEL` | Igual que `auditbrain-backend` | No |
| `LOCAL_LLM_API_KEY`, `DEEPSEEK_API_KEY` | Igual que `auditbrain-backend` | **Sí** |
| `DJ_AGENT_LLM_BUDGET_USD_DAY` / `_SESSION` | Tope de gasto estimado de IA (1.0 / 0.25 USD) | No |

**Application de la consola › Environment Variables:**

| Variable | Valor |
|---|---|
| `DJ_AGENT_URL` | `http://dj-agent:8790` (nombre corto; los largos no resuelven) |
| `DJ_AGENT_RATE_PER_MIN` | Opcional. Peticiones por minuto y por IP al agente (240 por defecto; `0` lo desactiva) |

Los valores secretos se escriben **solo en Coolify**, nunca en el chat, en un archivo del repositorio ni en un
mensaje. Tras cambiar una variable hay que hacer **Redeploy** del recurso donde se cambió.

## 4. Incidentes: qué hacer

### 4.1 «No suena» (lo más urgente)
1. Coolify › compose de streaming › ¿`engine` e `icecast` en verde («Running/Healthy»)?
2. Si `engine` está rojo: **Logs** de `engine` → copiar las últimas líneas → **Restart** del compose.
3. El agente **no** es la causa de un corte de audio: no hace falta detenerlo para recuperar el sonido.

### 4.2 La consola dice «modo demostración» o «agente no disponible»
| Mensaje / síntoma | Causa probable | Acción |
|---|---|---|
| `agent_not_configured` (503) | Falta `DJ_AGENT_URL` en la consola | Ponerla (§3) y Redeploy de la consola |
| `agent_unreachable` (502) | El servicio `dj-agent` está detenido o en otra red | Ver que `dj-agent` esté verde; el compose debe tener «Connect to predefined network» |
| `rate_limited` (429) | Demasiadas peticiones desde una IP | Esperar 30 s. Si es tráfico legítimo, subir `DJ_AGENT_RATE_PER_MIN` |
| No se conecta solo con la cuenta AUDIT-IA | Falta `DJ_AGENT_CC_API` o la cuenta no tiene la app «audit_sound» o debe cambiar su clave | Revisar §3 y la cuenta en el Command Center; mientras tanto usar una llave de respaldo |
| Conecta pero «no cambió el modo» | La cuenta entra como oyente | Agregar su correo con rol en `DJ_AGENT_CC_ROLES` y Redeploy del compose |

### 4.3 La salud dice `degraded`
- `engine.reachable: false`: el agente no llega al motor. Revisar `AUDIT_SOUND_API_USER`/`PASS` en el compose.
  Si otro panel usa la misma cuenta del Control API, el agente reintenta tomar el control (un controlador a la vez).
- `db: false`: el volumen `dj_agent_data` no está montado o está lleno. Ver §6.

### 4.4 La IA no responde (las órdenes funcionan, pero «por reglas»)
- En «Agente DJ» se ve el estado de Qwen/DeepSeek; el detalle del error está en Coolify › compose › `dj-agent` ›
  **Logs**. `insufficient_balance` = sin saldo en DeepSeek (recargar en su panel). Qwen caído = revisar el servidor de IA y que Hetzner siga en Tailscale.
- Tope de presupuesto alcanzado: `/usage` lo muestra; se reinicia al día siguiente o subiendo
  `DJ_AGENT_LLM_BUDGET_USD_DAY`.

## 5. Volver atrás (rollback)

- **Rápido, sin tocar el audio:** borrar `DJ_AGENT_URL` de la consola → Redeploy de la consola. Queda en modo
  demostración.
- **Apagar el agente:** compose de streaming › servicio `dj-agent` › **Stop**. El motor sigue con AutoMix.
- **Volver a una versión anterior:** Coolify › recurso › **Deployments** › elegir el despliegue anterior que estaba
  bien › **Redeploy**. En GitHub se puede revertir el PR con el botón **Revert** (crea un PR nuevo para revisar).
- **Login unificado con problemas:** borrar `DJ_AGENT_CC_API` del compose y Redeploy → el agente vuelve a aceptar
  solo las llaves de respaldo.

## 6. Respaldo de la base del agente

La base del agente (`/data/dj_agent.db`, volumen `dj_agent_data`) guarda sesiones, auditoría de órdenes y consumo de
IA. **No guarda audio ni la biblioteca.** Perderla no corta el sonido, pero se pierde la auditoría.

Copia en caliente (sin detener nada): Coolify › compose › servicio `dj-agent` › **Terminal** y pegar:

```bash
python -c "import sqlite3,time;s=sqlite3.connect('/data/dj_agent.db');d=sqlite3.connect('/data/respaldo-'+time.strftime('%Y%m%d')+'.db');s.backup(d);d.close();print('respaldo listo')"
```

Recomendado: una vez por semana y antes de cada despliegue. Para borrar respaldos viejos:
`ls -lh /data` y `rm /data/respaldo-AAAAMMDD.db`. Restaurar: detener `dj-agent`, renombrar el respaldo a
`dj_agent.db` desde la Terminal y volver a iniciar.

## 7. Rotación de llaves

| Llave | Cuándo | Cómo |
|---|---|---|
| `DJ_AGENT_DEV_TOKENS` | Si alguien deja el equipo o una llave se compartió | Generar en una terminal propia `python3 -c "import secrets;print(secrets.token_urlsafe(32))"`, reemplazar en Coolify, Redeploy |
| `DEEPSEEK_API_KEY` | Si se expuso (chat, captura, correo) | Revocar en el panel de DeepSeek, crear otra, pegarla en Coolify (agente y `auditbrain-backend`), Redeploy |
| `LOCAL_LLM_API_KEY` | Si se expuso | Cambiarla en el gateway de IA y en Coolify |
| Cuenta del Control API | Si se expuso | Cambiar `AUDIT_SOUND_API_USER`/`PASS` en el compose (motor y agente la toman de ahí) y Redeploy |

Con el login unificado, quitar el acceso a una persona es tan simple como retirarle la app «audit_sound» en el
Command Center: en menos de 60 s el agente deja de aceptarla (caché del token).

## 8. Vigilancia de producción propuesta

1. **Revisión diaria** (§2) la primera semana; luego semanal.
2. **Prueba de estabilidad en producción**: dejar el agente en AUTOMÁTICO un día de poca audiencia y anotar, al
   inicio y al final, el resultado de `verificar_despliegue_agente.sh` y la memoria de `engine` y `dj-agent`
   (Coolify › servicio › **Metrics**). Criterio: sin reinicios, sin cortes y memoria estable.
3. **Alertas**: Coolify › **Notifications** permite avisos por correo o Telegram cuando un contenedor se detiene o
   un despliegue falla. Recomendado activarlas para el compose de streaming y la consola.
