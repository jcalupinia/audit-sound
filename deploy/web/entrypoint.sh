#!/bin/sh
set -eu
# Genera config.js con la URL pública del stream (Icecast) y de la Control API.
OUT=/usr/share/nginx/html/config.js
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
