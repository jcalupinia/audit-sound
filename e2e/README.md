# Pruebas E2E (navegador real)

Pruebas de extremo a extremo de la consola con un navegador real (Playwright + Chromium).

## `console_engine_e2e.mjs` — consola sobre el MOTOR WASM real (Fase 0-B)

Abre `web/pro/console.html` (la consola con la imagen aprobada), arranca el **motor WASM**
(fork SideDeck+Mixxx), carga dos pistas, reproduce y **mide el audio real** (PEAK del worklet),
y comprueba crossfader / master / cue y la ausencia de errores JS.

Requisitos: haber compilado el motor y copiar sus artefactos junto a la página, y servir con
cabeceras COOP/COEP (SharedArrayBuffer).

```bash
# 1) compilar el motor WASM (Emscripten 6.0.13)
emcmake cmake -S wasm -B wasm/build -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build wasm/build --target audit_engine -j"$(nproc)"

# 2) servir una copia de web/pro con los artefactos del motor
tmp=$(mktemp -d); cp -r web/pro/* "$tmp/"; cp wasm/build/audit_engine.js wasm/build/audit_engine.wasm "$tmp/"
WEB_ROOT="$tmp" PORT=8193 node deploy/pro/server.js &     # server.js emite COOP/COEP

# 3) dos audios de prueba
ffmpeg -f lavfi -i "sine=frequency=440:duration=6" -ac 2 -ar 44100 /tmp/cancionA.wav -y
ffmpeg -f lavfi -i "sine=frequency=220:duration=6" -ac 2 -ar 44100 /tmp/cancionB.wav -y

# 4) la prueba (requiere playwright + chromium); usa cancionA.wav / cancionB.wav de <dir>
node e2e/console_engine_e2e.mjs /tmp
```

Resultado esperado: `RESULTADO CONSOLE+MOTOR: 10/10 OK` (incluye `PEAK del worklet > 0`, prueba de
que el motor produce audio real en el navegador). Verificado 2026-11-06.

> En producción, el paso de build del frontend (`deploy/pro/Dockerfile`) ya compila el WASM y copia
> `audit_engine.{js,wasm}` a `web/pro/`, así que la consola dispone del motor sin pasos manuales.
