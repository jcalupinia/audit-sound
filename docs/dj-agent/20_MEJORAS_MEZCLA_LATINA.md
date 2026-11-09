# 20 · Mezcla de la biblioteca latina: entrada en la parte fuerte, sin repeticiones, tempo y géneros

> **Estado:** en producción desde el 2026-11-09 (PR 72). Medición en producción en §2b.

Tras poner la biblioteca latina en producción (PR 71) se midieron las transiciones en el stream real y en un
ensayo local. Salieron tres problemas, que este cambio corrige.

## 1. Qué cambia

| Problema medido | Corrección | Dónde | Cómo se apaga |
|---|---|---|---|
| **Hueco de ~1 s** cuando la saliente termina de golpe y la entrante abre con una intro suave: «Los Cuban Boys → Cuban Cigars», bajón de **17 dB en producción** y 18 dB en el ensayo | La entrante con una intro suave de más de 2 s arranca **2 s antes de su parte fuerte**, sin saltar nunca más de 30 s de música | `mixpoints::loudStartSec` / `introStartSec`, `dj_analyze_loud_range`, `computeTransition` | `AUDIT_SOUND_INTRO_SALTO=0` · tope con `AUDIT_SOUND_INTRO_MAX` (s) |
| La misma canción podía sonar **dos veces seguidas**: el plan del agente elegía la pista que el motor ya tenía cargada como «siguiente», y el selector del motor no sabía qué había puesto la cola | El plan excluye la pista cargada en el otro deck. El selector registra lo que pone la cola (`Selector::notePlayed`) | `session_manager._cued`, `audit_sound_server.cpp::nextChained` | — |
| **Saltos de ritmo** entre géneros (bachata ~96, salsa ~100, mambo ~120, merengue ~135 BPM) | El tempo pesa más que la tonalidad (agente 0,40 frente a 0,35; motor 0,40 frente a 0,30). El agente mide la diferencia relativa y cuenta el doble o la mitad como el mismo pulso | `planner._tempo_gap`, `SelectorConfig` | — |
| «Pon merengue» no filtraba: **las canciones no tenían género** | Archivo `generos.txt` en la carpeta de música (`Título\|género`). El motor lo publica en `/api/tracks` (`"genre"`) y el agente filtra por él. El agente también entiende «mambo» y «cha cha cha» | `audit_sound_server.cpp::loadGenres`, `control_api_set_track_genre`, `engine_control_api.tracks`, `intent.GENRES` | Borrar el archivo |

Géneros de la biblioteca incluida:
- **Latina:** salsa (Los Cuban Boys, Danna Ruiz, El Gran Proyecto), merengue (Giovanny), bachata (Ronald Nuñez), mambo (Xaviant Haze) y cha cha cha (Juanitos).
- **House:** las 6 pistas.

Con `AUDIT_SOUND_BIBLIOTECA=todas` el entrypoint une ambos `generos.txt`.

Las variables del AutoMix (`AUDIT_SOUND_MIX_POINT`, `TEMPO_RETURN`, `MIX_MAX_ADELANTO`, `INTRO_SALTO`, `INTRO_MAX`)
ahora pasan por el compose, así que se pueden cambiar en Coolify. Dejarlas vacías no cambia nada.

## 2. Pruebas

- `mix_points_test`: **TODO OK**. Añade 10 casos: comienzo de la parte fuerte, punto de entrada, topes, apagado, y `dj_analyze_loud_range` sobre un WAV con intro suave.
- `selector_test`: **OK**.
  - 99,7 % de transiciones armónicas y sin repeticiones.
  - Tras una pista de la cola, el selector no la repite (0 de 200).
  - Desde 100 BPM elige la de 98 antes que la de 135 (50 de 50).
- `control_api_test`: **42 OK**. Se publica el género y no aparece un campo vacío.
- `engine_selftest` y `playback_recovery_test`: **OK**.
- Agente: `pytest` **246 pasan, 5 omitidas**, y `ruff` limpio.
  - Hay pruebas nuevas de géneros, órdenes latinas, tempo y la pista preparada.
  - La prueba de integración `test_el_plan_no_repite_la_pista_que_el_motor_ya_preparo` **falla con el código anterior** y pasa con el nuevo.
- Ensayo en vivo (motor real + Icecast, grabando como oyente) del par problemático: [`transiciones_intro_par_2026-11-08.md`](evidencias/transiciones_intro_par_2026-11-08.md).

| Transición | Antes (producción) | Después (ensayo) |
|---|---|---|
| Los Cuban Boys → Cuban Cigars | **17,0 dB** de bajón, cambio de 1 s | **0,8 dB**, mezcla de 10,5 s (la entrante entra en el segundo 6) |
| Cuban Cigars → Los Cuban Boys | — | 3,4 dB (sin intro suave: entra en su primer sonido) |

- Ensayo con las 7 pistas y el motor nuevo (21 min): **5 de 5 mezclas suaves**, bajón de −0,9 a 5,4 dB y
  6 títulos anunciados ([`transiciones_latina_mejoras_2026-11-08.md`](evidencias/transiciones_latina_mejoras_2026-11-08.md)).
  - Con el motor anterior hubo 4 de 5 en el ensayo y 3 de 4 en producción. La que fallaba, en ambos casos, era «Cuban Boys → Cuban Cigars».
  - Ninguna canción se repitió.
- Medición de producción con el motor anterior (línea base): [`transiciones_prod_latina_2026-11-08.md`](evidencias/transiciones_prod_latina_2026-11-08.md).

## 2b. Medición en producción (2026-11-09, 21 min tras el despliegue)

[`transiciones_prod_latina_v72_2026-11-09.md`](evidencias/transiciones_prod_latina_v72_2026-11-09.md):
- 5 transiciones, sin silencios. Ninguna canción sonó dos veces seguidas.
- **4 de 5 suaves**, con bajón de −1,5 a 2 dB.
- **Una con bajón de 7,3 dB:** Bachata Loca (~145 BPM) → Danna Ruiz (~99 BPM). Estudiada y corregida en §2c: no era el salto de tempo.

## 2c. El bajón de «La Bachata Loca → Alentando ilusiones»: un break de la saliente (2026-11-09)

**Causa (medida, no supuesta).**
- La Bachata Loca tiene un **break**: un corte musical de 1,5 s casi en silencio (−26 a −29 dBFS) entre los segundos 253,3 y 255,0. Después la música vuelve hasta el final.
- El fundido iba de 252 a 260 s, así que el break caía entre 1 y 3 s después de empezar, cuando la entrante sonaba aún al 25–60 % (curva del crossfader). Por eso se oía el hueco.
- En la grabación del ensayo, el mínimo del stream (−23,4 dBFS) cae exactamente en el break.
- El salto de tempo no influye en el volumen.
- Ninguna de las dos canciones tiene un tramo suave propio: el bajón aparece solo al mezclarlas.

**Corrección.** `mixpoints::breakFadeEnd` (`engine/automix/mix_points.hpp`).
- El motor mide el nivel de la pista cada 0,25 s, en la misma decodificación de siempre (`dj_analyze_mix_profile`).
- Si dentro del fundido hay un break, el fundido termina justo donde el break empieza.
  - Break: al menos 0,75 s a más de 9 dB bajo el nivel habitual, tras el cual la música vuelve antes de 4 s.
  - Así lo hace un DJ: suelta la saliente en su corte.
- Si el tramo nuevo del fundido tiene otro break, también lo esquiva (hasta 4 veces).
- Nunca adelanta más que el tope `AUDIT_SOUND_MIX_MAX_ADELANTO`.
- La caída final de la pista no cuenta como break: ahí la música no vuelve, y ese caso ya lo resuelve `energyFadeEnd`.
- Se apaga con `AUDIT_SOUND_BREAK_SALTO=0`.
- El registro del motor lo anota: `automix: break de la saliente en 254.00 s: el fundido termina ahí (antes 260.00)`.

**Resultado** ([evidencia](evidencias/transiciones_break_bachata_2026-11-09.md), motor real + Icecast):

| Transición | Antes | Después |
|---|---|---|
| Bachata Loca → Alentando ilusiones | **6,6 dB** (producción: 7,3 dB), «bajón de volumen» | **2,5 dB**, «mezcla suave» |
| Alentando ilusiones → Bachata Loca | 2,4 dB | 2,9 dB (sin cambio de lógica; variación de la medición) |

**Efecto en el resto de la biblioteca.** Comprobado sobre las 7 pistas latinas con el mismo análisis y con umbrales de 8, 9 y 10 dB: solo cambia el punto de mezcla de la Bachata Loca (de 260 s a 254 s). Las otras 6 quedan igual.

**Pruebas.** `mix_points_test` cubre:
- 8 casos de `breakFadeEnd`: break dentro y fuera del fundido, golpe seco de 0,5 s, caída final, tope de adelanto, dos breaks seguidos y sin datos.
- 4 casos de `dj_analyze_mix_profile` sobre un WAV con un break de 1,5 s, incluido el punto de mezcla resultante.

## 3. Límites conocidos

- Las diferencias de tempo entre géneros siguen oyéndose cuando no hay una pista de tempo cercano: el motor solo iguala diferencias de hasta el 6 %. Con 7 pistas, el orden por tempo ayuda poco.
- Los géneros salen de las categorías de Jamendo y del tempo medido: nadie los revisó escuchando. Se corrigen editando `generos.txt`.
- Saltar una intro suave es una decisión de DJ. Una balada con 20 s de piano entraría cerca de su parte fuerte. El tope (30 s) y `AUDIT_SOUND_INTRO_SALTO=0` lo limitan.
