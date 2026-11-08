# 19 · AutoMix: punto de mezcla por energía y regreso gradual al tempo propio

> **Estado:** en revisión, rama `claude/automix-energia-tempo`. Pedido por el dueño el 2026-11-08 («haz las 2 mejoras al
> motor») tras la primera medición de transiciones en producción (informe 18, §6).

## 1. Problemas medidos en producción

1. **Bajón de 5–7 dB en cada cambio de canción.** El AutoMix (port de Mixxx) terminaba el fundido en el último sonido
   de la saliente: mezclaba su cola, que ya se apaga, con la intro suave de la siguiente.
2. **La canción entrante se quedaba al tempo de la saliente** después del fundido (`syncTempo` ajustaba su velocidad y
   nunca la devolvía): toda la sesión derivaba hacia el tempo de las primeras pistas.

## 2. Qué cambia en el motor

| Cambio | Dónde | Cómo se apaga |
|---|---|---|
| Al cargar cada pista se mide su nivel segundo a segundo y se ubica el fin de su **parte fuerte** (último tramo a menos de 6 dB de su nivel habitual). El fundido termina 1 s después de ese punto, no en el último sonido | `dj_analyze_loud_end` (motor), `mixpoints::loudEndSec`, `computeTransition` | `AUDIT_SOUND_MIX_POINT=silence` |
| Tras el fundido, la pista que quedó sonando **vuelve a su tempo propio**: espera 4 s y avanza 0,3 % por segundo (6 % en ~20 s), sin saltos | `mixpoints::rampToward`, `startTempoReturn`/`stepTempoReturn` | `AUDIT_SOUND_TEMPO_RETURN=0` |
| El ajuste de tempo de la siguiente transición usa el tempo **efectivo** de la saliente | `syncTempo` | — |
| El log del motor muestra `fuerte_hasta=…` por pista y `deck N de vuelta a su tempo propio` | `automix.cpp` | — |

Solo se aplica en el modo 0 (salta silencios, el de producción); el modo 1 («pista completa») no cambia.

## 3. Pruebas

- `tools/mix_points_test.cpp` (nuevo, también en CI): 10/10 — fin de la parte fuerte en datos y en un WAV con cola que
  se apaga; sin decaimiento = hasta el final; silencio = −1; regreso de 6 % en ~20 s sin saltos mayores a 0,3 %/s.
- Motor: `engine_selftest`, `selector_test`, `control_api_test`, `playback_recovery_test` OK.
- Ensayo con Icecast y motor real, pistas de 80 s con **15 s de cola que se apaga** (como la música real):

| | Motor anterior (`MIX_POINT=silence`, `TEMPO_RETURN=0`) | Motor nuevo |
|---|---|---|
| Bajón durante el cambio | 5,8 – 6,3 dB (igual que en producción) | **0,8 – 1,5 dB** (5 corridas) |
| Regreso al tempo propio | no | **sí, 3/3 transiciones** por corrida (log del motor) |
| Cambio audible | 5,5 – 11 s | 7 – 10 s |

- Ensayo original (nivel constante, sin cola): RESULTADO OK, sin regresión.
- Nota: el BPM que el medidor estima desde el audio del stream tiene un error de hasta ~2,5 % y fallos ocasionales;
  por eso la prueba de tempo se apoya en el registro del motor y el BPM medido queda como dato informativo.

## 4. Pendiente

- Tras el merge (y el redeploy automático del compose): repetir `scripts/medir_transiciones.py --segundos 900` en
  producción y comparar con el informe 18, §6.
