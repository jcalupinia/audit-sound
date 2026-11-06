#!/usr/bin/env bash
# AUDIT SOUND · Soak del DJ automático (resistencia + memoria) — cierre de Fase 1.
#
# Corre el AutoMix en continuo durante DUR segundos y vigila:
#   - que el proceso NO se caiga (0 crashes),
#   - que la RSS (memoria) NO crezca de forma monotónica (fuga),
#   - que haya transiciones reales (el set avanza),
#   - que el stream MP3 a disco siga creciendo (sigue produciendo audio).
#
# Uso:
#   scripts/soak_autodj.sh                 # soak corto por defecto (90 s) con música sintética
#   DUR=3600 scripts/soak_autodj.sh        # soak de 1 h
#   DUR=14400 MUSIC_DIR=/ruta scripts/soak_autodj.sh   # 4 h con biblioteca real
#
# Variables: DUR (s, def 90) · SAMPLE (s entre muestras de RSS, def 10) ·
#            MUSIC_DIR (si no, genera 6 WAV sintéticos) · TRANSITION (s, def 4) ·
#            MAX_RSS_GROWTH_PCT (def 50: tope de crecimiento de RSS entre inicio y fin).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRV="$ROOT/build/audit_sound_server"
DUR="${DUR:-90}"; SAMPLE="${SAMPLE:-10}"; TRANSITION="${TRANSITION:-4}"
MAX_RSS_GROWTH_PCT="${MAX_RSS_GROWTH_PCT:-50}"

[ -x "$SRV" ] || { echo "Falta $SRV — compila: cmake -S . -B build -DCMAKE_POLICY_VERSION_MINIMUM=3.5 && cmake --build build"; exit 2; }

TMP="$(mktemp -d)"; trap 'kill "${PID:-0}" 2>/dev/null; rm -rf "$TMP"' EXIT
MDIR="${MUSIC_DIR:-}"
if [ -z "$MDIR" ]; then
  MDIR="$TMP/music"; mkdir -p "$MDIR"
  echo "Generando 6 pistas sintéticas (no se usan datos de clientes)…"
  i=0; for hz in 220 262 330 392 440 523; do
    ffmpeg -loglevel error -f lavfi -i "sine=frequency=$hz:duration=20" -ac 2 -ar 44100 "$MDIR/tono_$i.wav" -y || exit 2
    i=$((i+1))
  done
fi

LOG="$TMP/server.log"; MP3="$TMP/soak.mp3"
echo "Soak: DUR=${DUR}s TRANSITION=${TRANSITION}s MUSIC_DIR=$MDIR"
AUDIT_SOUND_MUSIC_DIR="$MDIR" AUDIT_SOUND_TRANSITION="$TRANSITION" \
  AUDIT_SOUND_MP3_OUT="$MP3" "$SRV" >"$LOG" 2>&1 &
PID=$!
sleep 2
kill -0 "$PID" 2>/dev/null || { echo "FALLO: el servidor no arrancó"; tail -20 "$LOG"; exit 1; }

rss_first=0; rss_last=0; rss_max=0; n=0; t=0
while [ "$t" -lt "$DUR" ]; do
  kill -0 "$PID" 2>/dev/null || { echo "FALLO: el proceso se cayó a los ${t}s"; tail -20 "$LOG"; exit 1; }
  rss=$(ps -o rss= -p "$PID" 2>/dev/null | tr -d ' '); rss=${rss:-0}
  [ "$n" -eq 0 ] && rss_first=$rss
  rss_last=$rss; [ "$rss" -gt "$rss_max" ] && rss_max=$rss
  printf "  t=%4ds  RSS=%6d KB\n" "$t" "$rss"
  n=$((n+1)); sleep "$SAMPLE"; t=$((t+SAMPLE))
done

kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null
trans=$(grep -c "transición" "$LOG" 2>/dev/null || echo 0)
mp3sz=$(stat -c%s "$MP3" 2>/dev/null || echo 0)
growth=0; [ "$rss_first" -gt 0 ] && growth=$(( (rss_last - rss_first) * 100 / rss_first ))

echo "----"
echo "RSS inicio=${rss_first}KB fin=${rss_last}KB máx=${rss_max}KB crecimiento=${growth}%"
echo "transiciones=$trans · mp3=${mp3sz} bytes"

pass=0; fail=0
chk(){ if [ "$1" -eq 1 ]; then echo "  OK   $2"; pass=$((pass+1)); else echo "  FAIL $2"; fail=$((fail+1)); fi; }
chk $([ "$trans" -ge 2 ] && echo 1 || echo 0) "hubo transiciones reales (set en continuo): $trans"
chk $([ "$mp3sz" -gt 10000 ] && echo 1 || echo 0) "produjo stream MP3 (sigue sonando): ${mp3sz}B"
chk $([ "$growth" -le "$MAX_RSS_GROWTH_PCT" ] && echo 1 || echo 0) "RSS no se dispara (≤${MAX_RSS_GROWTH_PCT}%): ${growth}%"
chk 1 "sin crash durante ${DUR}s"
echo ""; echo "RESULTADO SOAK: $pass OK, $fail FAIL (DUR=${DUR}s)"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
