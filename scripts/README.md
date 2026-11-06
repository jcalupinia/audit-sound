# scripts/ — Arneses de verificación de cierre de Fase 1

Pruebas de **resistencia y recuperación** del lado servidor (motor nativo + AutoMix +
streaming), para cerrar los puntos que la FASE 0 dejó como «NO VERIFICADO». Requieren el
motor nativo compilado:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build build -j"$(nproc)"
```

## `soak_autodj.sh` — soak del DJ automático (resistencia + memoria)

Corre el AutoMix en continuo y vigila que no se caiga, que la RSS no se dispare (fuga) y
que siga produciendo audio (stream MP3 a disco).

```bash
scripts/soak_autodj.sh                 # soak corto (90 s) con música sintética
DUR=3600 scripts/soak_autodj.sh        # 1 h
DUR=14400 MUSIC_DIR=/ruta scripts/soak_autodj.sh   # 4 h con biblioteca real
```
Variables: `DUR` (s), `SAMPLE` (s entre muestras de RSS), `MUSIC_DIR`, `TRANSITION`,
`MAX_RSS_GROWTH_PCT`. Criterio: `RESULTADO SOAK: 4 OK, 0 FAIL`. Verificado 2026-11-06
(60 s: 6 transiciones, RSS estable en ~76 MB tras el warmup, 0 crashes).

**Para el cierre formal de Fase 1**: correr `DUR=3600` (1 h) y, si se puede, 4 h/8 h, con
biblioteca **real** (no sintética), confirmando RSS sin crecimiento monotónico.

## `verificar_s1_reconexion.sh` — reconexión del stream (defecto S1)

Reproduce el escenario del defecto **S1** (FASE 0 F0_05): arranca Icecast + el servidor,
un oyente recibe MP3; **mata y reinicia Icecast**; comprueba que el servidor **reconecta
solo** (`IcecastByteSink::tryReconnect`) y el oyente vuelve a recibir MP3, sin reiniciar el
servidor.

```bash
scripts/verificar_s1_reconexion.sh
```
Requiere `icecast2` + `ffprobe`; si faltan, **salta** (no falla). Como root, baja
privilegios de Icecast a `nobody` con `<changeowner>`. Criterio: `RESULTADO S1: 3 OK, 0 FAIL`.
Verificado 2026-11-06 sobre `main` → **S1 corregido** (el servidor sobrevive y reconecta).

## Relación con los defectos de la FASE 0

| Defecto FASE 0 | Estado actual | Evidencia |
|---|---|---|
| **D1** AutoDJ no se recuperaba de pista corrupta/ausente | **CORREGIDO** | `build/playback_recovery_test` (en CI): 7/7, continuidad 100 %, 4 ausentes + 4 corruptas, recuperación |
| **S1** stream no reconectaba | **CORREGIDO** | `scripts/verificar_s1_reconexion.sh`: 3/3 |
| **Soak 1/4/8 h** | arnés listo; falta correr las horas | `scripts/soak_autodj.sh` |
