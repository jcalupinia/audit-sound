#!/bin/sh
set -eu
# Genera config.js con las URLs públicas que usa el frontend:
#   window.AUDIT_SOUND_STREAM  (STREAM_URL)  -> stream del Icecast
#   window.AUDIT_SOUND_API     (API_URL)     -> Control API del panel
#   window.AUDIT_SOUND_LISTEN  (LISTEN_URL)  -> consola pública de escucha;
#     por defecto "/", la raíz de este mismo dominio. Habilita el botón
#     "Escuchar la sesión" en /pro/index.html.
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
# Consola de escucha (habilita "Escuchar la sesión" en /pro/). Por defecto la
# raíz "/" de este dominio; se puede sobreescribir con la variable LISTEN_URL.
LISTEN_VALUE="${LISTEN_URL:-/}"
printf 'window.AUDIT_SOUND_LISTEN=%s;\n' "\"$LISTEN_VALUE\"" >> "$OUT"
echo "config.js: LISTEN_URL=$LISTEN_VALUE"
# Copia para el mezclador profesional (/pro/config.js).
mkdir -p "$ROOT/pro"
cp "$OUT" "$ROOT/pro/config.js"
