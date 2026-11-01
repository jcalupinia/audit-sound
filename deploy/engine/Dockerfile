# Motor AUDIT SOUND (audit_sound_server) — build multi-stage.
# Contexto de build = raíz del repo (ver docker-compose.yml).

# ---- build ----
FROM ubuntu:24.04 AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      cmake g++ make ca-certificates \
      libmp3lame-dev libshout3-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY engine ./engine
COPY third_party ./third_party
COPY tools ./tools
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j"$(nproc)" --target audit_sound_server

# ---- runtime ----
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      libmp3lame0 libshout3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/audit_sound_server /usr/local/bin/audit_sound_server
# La música se monta en /music (solo lectura). El destino Icecast va por entorno.
ENV AUDIT_SOUND_MUSIC_DIR=/music
# Reintenta si Icecast aún no está listo al arrancar.
CMD ["/bin/sh","-c","until audit_sound_server; do echo 'reintentando en 3s...'; sleep 3; done"]
