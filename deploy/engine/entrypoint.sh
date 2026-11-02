#!/bin/sh
set -eu
# Elige la fuente de música del DJ autónomo, por prioridad:
#   1) Subsonic/Navidrome si AUDIT_SOUND_SUBSONIC_URL está definida.
#   2) La carpeta /music si trae archivos de audio (tu biblioteca).
#   3) Audio de DEMO (tonos sintéticos del build) si AUDIT_SOUND_DEMO=1.
# Así el Preview suena de inmediato sin que tengas que subir música; pon tu
# biblioteca en /music (o configura Subsonic) para reemplazar la demo.

has_audio() {
  ls -A "$1" 2>/dev/null | grep -qiE '\.(mp3|wav|flac|opus|ogg|m4a|aac)$'
}

if [ -n "${AUDIT_SOUND_SUBSONIC_URL:-}" ]; then
  echo "fuente de música: Subsonic/Navidrome (${AUDIT_SOUND_SUBSONIC_URL})"
elif has_audio /music; then
  export AUDIT_SOUND_MUSIC_DIR=/music
  echo "fuente de música: carpeta /music"
elif [ "${AUDIT_SOUND_DEMO:-0}" = "1" ] || [ "${AUDIT_SOUND_DEMO:-0}" = "true" ]; then
  export AUDIT_SOUND_MUSIC_DIR=/demo-music
  echo "fuente de música: DEMO (tonos sintéticos). Pon tu biblioteca en /music para reemplazarla."
else
  echo "AVISO: sin fuente de música (ni Subsonic, ni /music, ni DEMO=1): el stream irá en silencio."
fi

# Reintenta hasta que Icecast esté listo.
until audit_sound_server; do
  echo "engine: reintentando en 3 s (¿Icecast aún no está listo?)..."
  sleep 3
done
