#!/usr/bin/env bash
# AUDIT SOUND · Verificación de S1 — reconexión automática del stream Icecast.
#
# Reproduce el escenario del defecto S1 (informe FASE0 F0_05) sobre el código actual:
#   1) arranca Icecast local + el servidor como fuente MP3; un oyente recibe MP3 válido,
#   2) MATA Icecast (caída) y lo REINICIA,
#   3) comprueba que el servidor se RECONECTA solo (IcecastByteSink::tryReconnect) y que
#      un oyente vuelve a recibir MP3 válido SIN reiniciar el servidor.
#
# Requiere icecast2 + ffprobe. Si faltan, SALTA con mensaje (no falla).
# Uso: scripts/verificar_s1_reconexion.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRV="$ROOT/build/audit_sound_server"
PORT="${ICECAST_PORT:-8990}"; MOUNT="/audit.mp3"; SRCPW="src_$RANDOM"

command -v icecast2 >/dev/null 2>&1 || command -v icecast >/dev/null 2>&1 || { echo "SALTADO: icecast no está instalado."; exit 0; }
command -v ffprobe >/dev/null 2>&1 || { echo "SALTADO: ffprobe (ffmpeg) no está instalado."; exit 0; }
[ -x "$SRV" ] || { echo "Falta $SRV — compila el motor primero."; exit 2; }
ICE="$(command -v icecast2 || command -v icecast)"

# icecast se niega a correr como root: baja privilegios con <changeowner>. Si somos root
# necesitamos un usuario sin privilegios (nobody) y un grupo (nogroup/nobody).
CHOWN=""
if [ "$(id -u)" = "0" ]; then
  RUNUSER="nobody"; RUNGROUP=""
  id "$RUNUSER" >/dev/null 2>&1 || { echo "SALTADO: no existe el usuario '$RUNUSER' para bajar privilegios de icecast."; exit 0; }
  for g in nogroup nobody daemon; do getent group "$g" >/dev/null 2>&1 && { RUNGROUP="$g"; break; }; done
  [ -n "$RUNGROUP" ] || { echo "SALTADO: no hay grupo sin privilegios para icecast."; exit 0; }
  CHOWN="<security><chroot>0</chroot><changeowner><user>$RUNUSER</user><group>$RUNGROUP</group></changeowner></security>"
fi

TMP="$(mktemp -d)"; MDIR="$TMP/music"; mkdir -p "$MDIR" "$TMP/log" "$TMP/web"
chmod -R 777 "$TMP"   # para que el usuario sin privilegios de icecast pueda escribir logs
trap 'kill "${SRVPID:-0}" "${ICEPID:-0}" 2>/dev/null; rm -rf "$TMP"' EXIT
for i in 0 1 2; do ffmpeg -loglevel error -f lavfi -i "sine=frequency=$((220+80*i)):duration=20" -ac 2 -ar 44100 "$MDIR/t$i.wav" -y || exit 2; done

cat >"$TMP/icecast.xml" <<XML
<icecast>
  <limits><clients>20</clients><sources>2</sources></limits>
  <authentication>
    <source-password>$SRCPW</source-password>
    <admin-user>admin</admin-user><admin-password>adm_$RANDOM</admin-password>
  </authentication>
  <hostname>localhost</hostname>
  <listen-socket><port>$PORT</port></listen-socket>
  <paths><logdir>$TMP/log</logdir><webroot>$TMP/web</webroot><adminroot>$TMP/web</adminroot></paths>
  <logging><loglevel>2</loglevel></logging>
  $CHOWN
</icecast>
XML

start_icecast(){ "$ICE" -c "$TMP/icecast.xml" >"$TMP/log/ice.out" 2>&1 & ICEPID=$!; for _ in $(seq 1 20); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && return 0; sleep 0.3; done; return 1; }
capture_once(){ # captura ~6s del mount; 0 si es MP3 válido con audio
  local out="$1"; curl -s --max-time 7 "http://127.0.0.1:$PORT$MOUNT" -o "$out" 2>/dev/null
  local codec; codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$out" 2>/dev/null)
  local sz; sz=$(stat -c%s "$out" 2>/dev/null || echo 0)
  [ "$codec" = "mp3" ] && [ "$sz" -gt 20000 ]
}
listen_ok(){ # reintenta hasta ~20s (da tiempo a que la fuente (re)conecte)
  local out="$1"; for _ in $(seq 1 4); do capture_once "$out" && return 0; sleep 2; done; return 1
}

echo "1) Arrancando Icecast (:$PORT) + servidor fuente…"
start_icecast || { echo "FALLO: Icecast no arrancó"; exit 1; }
AUDIT_SOUND_MUSIC_DIR="$MDIR" AUDIT_SOUND_TRANSITION=4 \
  AUDIT_SOUND_ICECAST_HOST=127.0.0.1 AUDIT_SOUND_ICECAST_PORT="$PORT" \
  AUDIT_SOUND_ICECAST_MOUNT="$MOUNT" AUDIT_SOUND_ICECAST_USER=source \
  AUDIT_SOUND_ICECAST_PASSWORD="$SRCPW" "$SRV" >"$TMP/log/srv.out" 2>&1 &
SRVPID=$!
sleep 4
pass=0; fail=0
chk(){ if [ "$1" -eq 1 ]; then echo "  OK   $2"; pass=$((pass+1)); else echo "  FAIL $2"; fail=$((fail+1)); fi; }

if listen_ok "$TMP/a.mp3"; then chk 1 "oyente recibe MP3 válido ANTES de la caída"; else chk 0 "oyente recibe MP3 válido ANTES de la caída"; fi

echo "2) Matando Icecast (simula caída) y reiniciando…"
kill "$ICEPID" 2>/dev/null; wait "$ICEPID" 2>/dev/null; sleep 3
if kill -0 "$SRVPID" 2>/dev/null; then chk 1 "el servidor sigue vivo tras caer el stream"; else chk 0 "el servidor sigue vivo tras caer el stream"; fi
start_icecast || { echo "FALLO: Icecast no reinició"; exit 1; }

echo "3) Esperando reconexión automática (tryReconnect, ~2s de enfriamiento)…"
sleep 4
if listen_ok "$TMP/b.mp3"; then chk 1 "oyente VUELVE a recibir MP3 tras reiniciar Icecast (S1 reconecta)"; else chk 0 "oyente VUELVE a recibir MP3 tras reiniciar Icecast (S1 reconecta)"; fi
grep -qiE "reconect|conectado" "$TMP/log/srv.out" 2>/dev/null && echo "  (log del servidor registra (re)conexión)"

kill "$SRVPID" "$ICEPID" 2>/dev/null
echo ""; echo "RESULTADO S1: $pass OK, $fail FAIL"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
