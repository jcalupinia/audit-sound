#!/usr/bin/env bash
# Verifica el despliegue del agente DJ detrás de la consola, SIN credenciales.
# Uso: scripts/verificar_despliegue_agente.sh https://sound.audit-ia.ec
set -uo pipefail
BASE="${1:?Uso: $0 https://<dominio-de-la-consola>}"
BASE="${BASE%/}"
fails=0
ok()   { echo "OK    $1"; }
fail() { echo "FALLA $1"; fails=$((fails + 1)); }

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/healthz" || echo 000)
[ "$code" = 200 ] && ok "consola en línea (/healthz 200)" || fail "consola /healthz → $code"

cfg=$(curl -sS --max-time 15 "$BASE/config.js" || true)
if grep -q 'AUDIT_SOUND_AGENT=true' <<<"$cfg"; then ok "la consola anuncia el agente (DJ_AGENT_URL definida)"
else fail "config.js no anuncia el agente: falta DJ_AGENT_URL en la aplicación de la consola"; fi
if grep -qiE 'dj-agent[^"]*:8790|http://[a-z0-9-]+:8790' <<<"$cfg"; then fail "config.js revela la URL interna del agente"; fi

health=$(curl -sS --max-time 20 "$BASE/api/v1/dj-agent/health" || true)
python3 - "$health" <<'EOF' || fails=$((fails + 1))
import json, sys
raw = sys.argv[1]
try:
    h = json.loads(raw)
except ValueError:
    print("FALLA el proxy no devolvió JSON del agente:", raw[:200]); sys.exit(1)
if "error" in h:
    print("FALLA proxy →", h["error"].get("code"), "·", h["error"].get("message")); sys.exit(1)
r = h.get("readiness", {})
bad = 0
def chk(c, m):
    global bad
    print(("OK    " if c else "FALLA ") + m); bad += (not c)
chk(h.get("liveness") is True, f"agente vivo (versión {h.get('version')})")
chk(r.get("db") is True, "base del agente accesible")
eng = r.get("engine", {})
chk(eng.get("kind") == "control_api", f"agente usa el motor real (kind={eng.get('kind')})")
chk(eng.get("reachable") is True, "motor C++ alcanzable desde el agente" + ("" if eng.get("reachable") else f" — {eng.get('error')}"))
caps = set(eng.get("capabilities") or [])
chk("queue" in caps, f"motor con cola del agente (Fase 2): {sorted(caps)}")
if "metadata" not in caps:   # se detecta al leer el catálogo por primera vez, no en la salud
    print("AVISO metadatos del catálogo: se confirman al conectar la consola (primera lectura del catálogo)")
for m in r.get("models", []):
    print(("OK    " if m.get("configured") else "AVISO ") + f"modelo {m['name']}: " +
          (f"configurado ({m.get('model')})" if m.get("configured") else "sin configurar (el agente usa reglas)"))
sys.exit(1 if bad else 0)
EOF

echo
[ "$fails" -eq 0 ] && echo "RESULTADO: OK" || echo "RESULTADO: FALLA ($fails)"
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
