# 18 · Títulos en el stream y medición de transiciones en vivo

> **Estado:** en revisión, rama `claude/titulos-y-transiciones`. Pedido por el dueño el 2026-11-08, tras escuchar la
> primera grabación de producción: «no hemos probado con música real viendo cómo el agente mezcla en vivo».

## 1. Punto de partida (producción, 2026-11-08, 6 min grabados del stream público)

- Sin cortes ni silencios; 192 kbps; −9,7 LUFS integrados.
- El motor usa la biblioteca libre `/cc-music` (6 pistas Creative Commons, deep/tech house).
- **El stream no anunciaba títulos** (`StreamTitle=''`): ni los oyentes ni las pruebas podían saber dónde
  cambia la canción. Sin eso no se puede evaluar la mezcla.

## 2. Qué se entregó

| Elemento | Estado | Evidencia |
|---|---|---|
| El motor publica «Artista - Tema» como título del stream (ICY `StreamTitle`) al cambiar de pista | **REAL** | ensayo local: títulos anunciados = archivos de la biblioteca |
| El título se aplica en el mismo hilo que envía el audio (libshout no es multihilo) y se re-anuncia tras reconectar a Icecast | **REAL** | código (`icecast_byte_sink.hpp`) |
| Con Subsonic se usa el título que entrega el servidor (sus archivos temporales se llaman `t0.mp3`…) | **REAL** (código) | sin servidor Subsonic de prueba |
| El motor registra `título del stream: …` y `en el aire: …` en su log | **REAL** | ensayo local |
| `scripts/medir_transiciones.py`: graba el stream como un oyente y, por cada cambio, mide cambio audible, bajón de volumen, BPM saliente/entrante y da un veredicto | **REAL** | ensayo local (3 corridas) |
| `scripts/ensayo_titulos_transiciones.py`: Icecast + motor real + 4 pistas de BPM y títulos conocidos | **REAL** | 3 corridas: RESULTADO OK |

## 3. Resultados del ensayo local (motor real, fundido configurado 8 s)

Tres corridas, todas **RESULTADO: OK**. Cambio audible medido: 6,0 – 8,5 s (configurado 8 s); bajón de volumen ≤ 0,5 dB;
el cambio empieza ~8 s antes del anuncio del título (el título se publica al terminar el fundido).

**Hallazgo del motor (no corregido en este PR):** el AutoMix iguala el tempo de la pista entrante con la saliente
(`syncTempo`) y la entrante **sigue a ese tempo** después del fundido: en el ensayo, pistas de 122 y 124 BPM sonaron a
~129 y ~118 BPM. Con música real, si el keylock está apagado, eso también cambia el tono. Se propone revisarlo aparte
(volver gradualmente al tempo propio o limitar el ajuste a ±6 %).

## 4. Cómo medir producción (tras el merge y el redeploy del compose de streaming)

```bash
python3 scripts/medir_transiciones.py --segundos 900 --salida transiciones_prod
```

Graba 15 min del stream público (sin credenciales) y escribe `transiciones.md` y `transiciones.json`. Requiere
ffmpeg y numpy.

## 5. Pendiente

- Correr el medidor en producción con las 6 pistas reales (requiere este merge y el redeploy).
- Revisar el hallazgo del tempo (§3).
- El ensayo no está en CI: necesita Icecast y ~3 min; se corre a mano.
