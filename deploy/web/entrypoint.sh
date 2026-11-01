#!/bin/sh
set -eu
# Genera config.js con la URL pública del stream (Icecast en Coolify).
# STREAM_URL p.ej. https://stream.audit-ia/stream.mp3
STREAM_URL="${STREAM_URL:-}"
OUT=/usr/share/nginx/html/config.js
if [ -n "$STREAM_URL" ]; then
  printf 'window.AUDIT_SOUND_STREAM=%s;\n' "\"$STREAM_URL\"" > "$OUT"
  echo "config.js: STREAM_URL=$STREAM_URL"
else
  printf '/* sin STREAM_URL; se usa ?stream= o <origin>/stream.mp3 */\n' > "$OUT"
  echo "config.js: sin STREAM_URL"
fi
