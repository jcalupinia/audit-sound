# syntax=docker/dockerfile:1
# Preview del mezclador PRO (web/pro) para Coolify: compila el motor a WebAssembly y
# sirve el sitio estático con cabeceras COOP/COEP (SharedArrayBuffer) y MIME de .wasm.
# Construir desde la RAÍZ del repo:  docker build -f deploy/pro/Dockerfile .

# --- Etapa 1: compilar el motor WASM ---
# La imagen debe coincidir con el Emscripten del proyecto (emcc 6.0.13). Si ese tag no
# existe en el registro, usar el 6.0.x más cercano.
FROM emscripten/emsdk:6.0.13 AS wasm
WORKDIR /src
COPY wasm/ ./wasm/
COPY engine/ ./engine/
COPY third_party/ ./third_party/
RUN cd wasm && rm -rf build && mkdir build && cd build \
 && emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
 && cmake --build . --target audit_engine -j"$(nproc)"

# --- Etapa 2: servidor estático ---
FROM node:22-alpine
WORKDIR /app
# Frontend PRO (sin los archivos de prueba que viven junto al código).
COPY web/pro/ /app/web/
RUN rm -f /app/web/bridge_test.html /app/web/bridge_browser_test.js \
          /app/web/*_test.js /app/web/*.mjs /app/web/serve_coop.js /app/web/track.wav 2>/dev/null || true
# Motor WASM recién compilado.
COPY --from=wasm /src/wasm/build/audit_engine.js /src/wasm/build/audit_engine.wasm /app/web/
COPY deploy/pro/server.js /app/server.js
ENV WEB_ROOT=/app/web PORT=80
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
CMD ["node", "/app/server.js"]
