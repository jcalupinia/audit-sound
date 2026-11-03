#!/bin/sh
set -eu
# Genera config.js con la URL pública del stream (Icecast) y de la Control API.
# Se escribe en la raíz (/config.js) y también en /pro/ (/pro/config.js), porque
# el mezclador profesional (/pro/mixer.html) lo carga como ruta relativa
# ("config.js"), que resuelve a /pro/config.js.
ROOT=/usr/share/nginx/html
OUT="$ROOT/config.js"
: > "$OUT"
if [ -n "${STREAM_URL:-}" ]; then
  printf 'window.AUDIT_SOUND_STREAM=%s;\n' "\"$STREAM_URL\"" >> "$OUT"
  echo "config.js: STREAM_URL=$STREAM_URL"
fi
if [ -n "${API_URL:-}" ]; then
  printf 'window.AUDIT_SOUND_API=%s;\n' "\"$API_URL\"" >> "$OUT"
  echo "config.js: API_URL=$API_URL"
fi
[ -s "$OUT" ] || printf '/* sin STREAM_URL/API_URL; usar ?stream= / ?api= */\n' > "$OUT"
# Copia para el mezclador profesional (/pro/config.js).
mkdir -p "$ROOT/pro"
cp "$OUT" "$ROOT/pro/config.js"
