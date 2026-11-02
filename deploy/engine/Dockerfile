# Motor AUDIT SOUND (audit_sound_server) — build multi-stage.
# Contexto de build = raíz del repo (ver docker-compose.yml).

# ---- build ----
FROM ubuntu:24.04 AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      cmake g++ make ca-certificates pkg-config ffmpeg \
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

# ---- runtime ----
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      libmp3lame0 libshout3 ca-certificates libcurl4t64 libmicrohttpd12 \
      libavcodec60 libavformat60 libavutil58 libswresample4 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/audit_sound_server /usr/local/bin/audit_sound_server
COPY --from=build /demo-music /demo-music
COPY deploy/engine/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
# La música se monta en /music (solo lectura); el entrypoint elige la fuente
# (Subsonic > /music > demo). El destino Icecast va por variables de entorno.
CMD ["/usr/local/bin/entrypoint.sh"]
