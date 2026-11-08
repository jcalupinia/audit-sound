# Motor AUDIT SOUND (audit_sound_server) — build multi-stage.
# Contexto de build = raíz del repo (ver docker-compose.yml).

# ---- build ----
FROM ubuntu:24.04 AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      cmake g++ make ca-certificates pkg-config ffmpeg curl \
      libmp3lame-dev libshout3-dev libcurl4-openssl-dev libmicrohttpd-dev \
      libavcodec-dev libavformat-dev libavutil-dev libswresample-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY engine ./engine
COPY third_party ./third_party
COPY tools ./tools
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j"$(nproc)" --target audit_sound_server
# Audio de DEMO: 4 pistas sintéticas (tonos) de 30 s para que el Preview suene sin
# que haya que subir música. No es material con derechos.
RUN mkdir -p /demo-music && for s in "220 277" "330 392" "440 554" "165 196"; do \
      set -- $s; \
      ffmpeg -nostdin -loglevel error \
        -f lavfi -i "sine=frequency=$1:sample_rate=48000:duration=30" \
        -f lavfi -i "sine=frequency=$2:sample_rate=48000:duration=30" \
        -filter_complex "[0][1]amix=inputs=2:normalize=0,volume=0.4,aformat=channel_layouts=stereo" \
        -c:a libmp3lame -b:a 192k "/demo-music/demo_${1}.mp3"; \
    done
# Biblioteca por defecto: deep/tech house con licencia libre (Creative Commons BY-SA 3.0),
# recopilación "MNS006 V.A - Colores Paralelos" del netlabel Monofónicos, vía Internet Archive.
# Se usa cuando /music está vacío. Atribución en deploy/engine/MUSIC_CREDITS.md.
# Descarga best-effort: si una pista falla se omite (no rompe el build); si ninguna baja,
# el entrypoint cae a la demo sintética.
RUN mkdir -p /cc-music && cd /cc-music \
 && base="https://archive.org/download/MNS006_VA--Colores_Paralelos" \
 && for pair in \
      "01_Paulo_Olarte_-_Cielos.mp3|Paulo Olarte - Cielos.mp3" \
      "05_Ruido_Selecto_-_Talisman.mp3|Ruido Selecto - Talisman.mp3" \
      "06_Sir_Leaks_-_Espejismo.mp3|Sir Leaks - Espejismo.mp3" \
      "11_Deraout_-_Electricamente.mp3|Deraout - Electricamente.mp3" \
      "13_MALA_-_Bang_It.mp3|MALA - Bang It.mp3" \
      "14_V%C3%A9lez_-_Down_By_Law.mp3|Velez - Down By Law.mp3"; do \
      src="${pair%%|*}"; dst="${pair#*|}"; \
      curl -fL --retry 3 --retry-delay 2 -o "$dst" "$base/$src" \
        || { echo "WARN: no se pudo descargar $dst"; rm -f "$dst"; }; \
    done \
 && printf '%s\n' "# Título|género (lo lee el motor; ver cc-music-latina/generos.txt)" \
      "Paulo Olarte - Cielos|house" "Ruido Selecto - Talisman|house" "Sir Leaks - Espejismo|house" \
      "Deraout - Electricamente|house" "MALA - Bang It|house" "Velez - Down By Law|house" > /cc-music/generos.txt \
 && echo "cc-music:" && ls -la /cc-music

# ---- runtime ----
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      libmp3lame0 libshout3 ca-certificates libcurl4t64 libmicrohttpd12 \
      libavcodec60 libavformat60 libavutil58 libswresample4 procps \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/audit_sound_server /usr/local/bin/audit_sound_server
COPY --from=build /demo-music /demo-music
COPY --from=build /cc-music /cc-music
# Biblioteca latina (salsa, merengue, cha-cha-chá, bachata) con licencia Creative Commons BY/BY-SA,
# guardada en el repositorio para que el build no dependa de descargas. Créditos en MUSIC_CREDITS.md.
COPY deploy/engine/cc-music-latina /cc-music-latina
COPY deploy/engine/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
# La música se monta en /music (solo lectura); el entrypoint elige la fuente
# (Subsonic > /music > biblioteca libre /cc-music > demo). El destino Icecast va por env.
CMD ["/usr/local/bin/entrypoint.sh"]
