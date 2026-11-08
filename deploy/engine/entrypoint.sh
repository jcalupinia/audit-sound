#!/bin/sh
set -eu
# Elige la fuente de música del DJ autónomo, por prioridad:
#   1) Subsonic/Navidrome si AUDIT_SOUND_SUBSONIC_URL está definida.
#   2) La carpeta /music si trae archivos de audio (tu biblioteca).
#   3) Biblioteca libre incluida en la imagen (Creative Commons): latina por defecto,
#      o deep/tech house / ambas con AUDIT_SOUND_BIBLIOTECA=house|todas.
#   4) Audio de DEMO (tonos sintéticos del build) si AUDIT_SOUND_DEMO=1.
# Así el stream suena de inmediato con música real libre de derechos; pon tu
# biblioteca en /music (o configura Subsonic) para reemplazarla.

has_audio() {
  ls -A "$1" 2>/dev/null | grep -qiE '\.(mp3|wav|flac|opus|ogg|m4a|aac)$'
}

if [ -n "${AUDIT_SOUND_SUBSONIC_URL:-}" ]; then
  echo "fuente de música: Subsonic/Navidrome (${AUDIT_SOUND_SUBSONIC_URL})"
elif has_audio /music; then
  export AUDIT_SOUND_MUSIC_DIR=/music
  echo "fuente de música: carpeta /music"
elif has_audio /cc-music || has_audio /cc-music-latina; then
  # AUDIT_SOUND_BIBLIOTECA elige la biblioteca libre incluida en la imagen:
  #   latina (por defecto): salsa, merengue, cha-cha-chá y bachata · house: deep/tech house · todas: ambas.
  case "${AUDIT_SOUND_BIBLIOTECA:-latina}" in
    house) dir=/cc-music; desc="deep/tech house" ;;
    todas)
      dir=/tmp/biblioteca-todas; desc="latina + deep/tech house"
      mkdir -p "$dir"
      for f in /cc-music/* /cc-music-latina/*; do
        case "$f" in */generos.txt) ;; *) [ -f "$f" ] && ln -sf "$f" "$dir/" ;; esac
      done
      cat /cc-music/generos.txt /cc-music-latina/generos.txt > "$dir/generos.txt" 2>/dev/null || true ;;
    *) dir=/cc-music-latina; desc="latina: salsa, merengue, cha-cha-chá, bachata" ;;
  esac
  has_audio "$dir" || { dir=/cc-music; desc="deep/tech house"; }
  export AUDIT_SOUND_MUSIC_DIR="$dir"
  echo "fuente de música: biblioteca libre $dir (Creative Commons — $desc)"
elif [ "${AUDIT_SOUND_DEMO:-0}" = "1" ] || [ "${AUDIT_SOUND_DEMO:-0}" = "true" ]; then
  export AUDIT_SOUND_MUSIC_DIR=/demo-music
  echo "fuente de música: DEMO (tonos sintéticos). Pon tu biblioteca en /music para reemplazarla."
else
  echo "AVISO: sin fuente de música (ni Subsonic, ni /music, ni biblioteca libre, ni DEMO=1): el stream irá en silencio."
fi

# Reintenta hasta que Icecast esté listo.
until audit_sound_server; do
  echo "engine: reintentando en 3 s (¿Icecast aún no está listo?)..."
  sleep 3
done
