# A4-04 — Continuidad y estabilidad del motor

Prueba: `tools/playback_recovery_test.cpp` (en CI). Motor nativo con OfflineSink
(headless) + AutoMix autónomo. **7/7 OK**.

## Qué se ejercita y se MIDE

La fuente de pistas falla de forma intermitente alternando **dos rutas de fallo**:
- archivos **AUSENTES** (ruta inexistente → fallo al abrir), y
- archivos **CORRUPTOS** (existen pero no se pueden decodificar).

Se observa la reproducción durante ~8 s forzando transiciones y se **mide la mayor
interrupción** (muestreo cada 200 ms), sin declarar continuidad perfecta sin medición.

```
muestras=40 sonando=40 (100%) huecos=0 · interrupcion_maxima=0ms · ausentes=4 corruptas=4 buenas=9
OK se ejercitó una fuente con archivos AUSENTES
OK se ejercitó una fuente con archivos CORRUPTOS
OK se sirvieron pistas buenas tras los fallos (recuperación)
OK se reprodujeron ambas pistas buenas
OK reproducción continua ≥90% del tiempo pese a los fallos
OK la mayor interrupción observada fue breve (≤400ms, medida real)
OK sin cuelgue ni caída
RESULTADO: 7 OK, 0 FAIL
```

## Mecanismo de recuperación (ya en el motor)

`automix.cpp::loadIntoRetry(deck, 32)`: ante un fallo de carga reintenta con la siguiente
pista de la fuente (hasta 32), saltando ausentes/corruptas. El cambio entre decks y el
crossfade por posición continúan. La búsqueda del frontend corre en el hilo principal
(fetch asíncrono) y **no bloquea** el hilo de audio (worklet), verificado aparte.

## Cubierto por otras pruebas

- Cambio entre decks y encadenado: `selector_test` (99,2 % armónico) + este test.
- Arranque/stop del motor y sink: `engine_selftest`.

## Pendiente (requiere infraestructura no disponible en el entorno)

- **Reconexión de streaming / Icecast ante fallo temporal.** El engine ya reintenta la
  conexión a Icecast al arrancar (ver `deploy/docker-compose.yml`), pero una prueba
  **automatizada** de reconexión exige una instancia de Icecast que se pueda tumbar y
  levantar; no está disponible en este entorno. Queda identificado como prueba de
  integración pendiente (no es un fallo del código, es una limitación del entorno).
- **Memoria en reproducción prolongada:** el test cubre continuidad corta; una prueba de
  larga duración (horas) con vigilancia de memoria requiere un entorno de ejecución
  prolongado. Pendiente de medición explícita.
