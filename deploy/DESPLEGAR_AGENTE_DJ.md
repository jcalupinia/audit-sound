# Desplegar el Agente DJ en Coolify (Hetzner)

Despliegue **autorizado por el dueño el 2026-11-07**. Los clics en Coolify los hace el dueño: desde la sesión de
desarrollo no hay acceso de escritura a Coolify. Al terminar, la verificación se hace con
`scripts/verificar_despliegue_agente.sh` (sin credenciales).

## 0. Cómo queda armado

```
navegador ──HTTPS──► sound.audit-ia.ec  (Application · deploy/pro/Dockerfile · consola v0.6)
                          │  proxy /api/v1/dj-agent/*  (DJ_AGENT_URL, red interna de Coolify)
                          ▼
                     dj-agent:8790  (servicio del Docker Compose · SIN dominio público)
                          │  Control API interna                │  IA
                          ▼                                     ▼
                     engine:8787 (motor C++)          Qwen por Tailscale · DeepSeek por internet
```

- El agente **no se expone a internet**: solo lo ve la consola por la red interna de Coolify.
- Si el agente se cae, el motor sigue sonando con AutoMix y la consola vuelve a modo demostración.

## 1. Requisitos (comprobar antes)

1. El **Docker Compose de streaming** (`deploy/docker-compose.yml`, Preview B) existe en Coolify y el motor suena.
2. El **servidor Hetzner está en la tailnet** (el `auditbrain-backend` ya llega a
   `auditia.tail70d973.ts.net`, así que debería estarlo). Sin esto, el agente funciona igual con DeepSeek y con
   reglas, pero sin el Qwen local.
3. `AUDIT_SOUND_API_USER` y `AUDIT_SOUND_API_PASS` definidas en el compose (la Control API del motor). Sin ellas
   el agente no puede comandar el motor y su salud dirá `engine.reachable: false`.

## 2. Variables nuevas en el Docker Compose (Coolify › compose de streaming › Environment Variables)

| Variable | Valor | ¿Secreta? |
|---|---|---|
| `DJ_AGENT_DEV_TOKENS` | `TOKEN1:jorge:admin:auditconsulting;TOKEN2:operador:operator:auditconsulting` | **Sí** |
| `LOCAL_LLM_BASE_URL` | el mismo que `auditbrain-backend` (`https://auditia.tail70d973.ts.net:10000/v1`) | No |
| `LOCAL_LLM_MODEL` | `auditia-rutina` | No |
| `LOCAL_LLM_API_KEY` | copiar de `auditbrain-backend` | **Sí** |
| `DEEPSEEK_API_KEY` | copiar de `auditbrain-backend` (la vigente, no la revocada) | **Sí** |
| `DEEPSEEK_MODEL` | `deepseek-flash` | No |
| `DJ_AGENT_CC_API` | el mismo valor que `AUDIT_SOUND_CC_API` de la consola (Fase 7, login unificado) | No |
| `DJ_AGENT_CC_ROLES` | `correo-del-dueno:admin;correo-operador:operator` (quien no figure entra como oyente) | No |

Cada `TOKEN` se genera en una terminal (no en el chat) con:

```bash
python3 -c "import secrets;print(secrets.token_urlsafe(32))"
```

Con `DJ_AGENT_CC_API` la consola se conecta sola con la sesión AUDIT-IA (cuentas con la app «audit_sound»); los
tokens quedan como **llaves de respaldo** que se pegan en la consola si el Command Center no responde. Roles: `admin`,
`operator` (opera), `supervisor` (aprueba y ve el consumo), `listener` (solo mira).

## 3. Red compartida y despliegue del compose

1. En el compose de streaming › **Advanced** › **Docker compose** › **Predefined network**: elegir
   **«Connect to predefined network»** (en vez de «Isolated network only»), para que la consola, que es otra
   aplicación, pueda llegar al agente por la red `coolify`. Verificado en Coolify 4.6 (2026-11-08).
2. **Deploy** (o Redeploy). La primera vez construye la imagen del agente (≈1 min) y la del motor con los
   cambios de las Fases 2–6.
3. En **Logs** del servicio `dj-agent` debe aparecer `agente iniciado · motor=control_api`.

## 4. Conectar la consola (Coolify › Application `sound.audit-ia.ec` › Environment Variables)

| Variable | Valor |
|---|---|
| `DJ_AGENT_URL` | `http://dj-agent:8790` |

Verificado en producción (2026-11-08): desde la consola el nombre que resuelve es el **corto** `dj-agent`. Los
nombres largos `dj-agent-<uuid>` no resuelven (Coolify 4.6 genera nombres de contenedor con fecha). Para
comprobarlo desde **Terminal** de la consola:
`node -e "fetch('http://dj-agent:8790/api/v1/dj-agent/health').then(r=>r.text()).then(console.log)"`.

**Redeploy** de la aplicación. En sus logs debe aparecer `config.js: agente DJ CONECTADO por proxy`.

## 5. Verificar

Desde cualquier equipo:

```bash
scripts/verificar_despliegue_agente.sh https://sound.audit-ia.ec
```

Debe terminar en `RESULTADO: OK`. Luego, en el navegador: `https://sound.audit-ia.ec/v06/` → entrar → «Agente DJ
inteligente» → debe conectarse solo con la sesión AUDIT-IA (o pegar una llave de respaldo → «Conectar agente») → probar «salta la canción» y un cambio de modo. En el teléfono:
`deploy/PROBAR_IPHONE.md`, sección C.

## 6. Volver atrás (sin tocar el audio)

- **Rápido:** borrar `DJ_AGENT_URL` de la aplicación de la consola y redeploy → la consola vuelve a modo
  demostración. El motor y el stream no se tocan.
- **Completo:** detener el servicio `dj-agent` del compose. El motor sigue con AutoMix.

## 7. Riesgos conocidos

- Login unificado (Fase 7): si el Command Center no responde, nadie entra con su sesión hasta que vuelva; las
  llaves de respaldo siguen funcionando. Operación e incidentes: `docs/dj-agent/RUNBOOK_AGENTE_DJ.md`.
- La Control API del motor admite **un controlador a la vez**: si otro panel la usa con la misma cuenta, el
  agente reintenta tomar el control.
- Las tarifas que muestra `/usage` son una estimación configurada.
