# 20 · Mezcla de la biblioteca latina: entrada en la parte fuerte, sin repeticiones, tempo y géneros

> **Estado:** implementado y probado en local con el motor real (2026-11-08). Pendiente de merge y despliegue.

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

- Medición de producción con el motor anterior (línea base): [`transiciones_prod_latina_2026-11-08.md`](evidencias/transiciones_prod_latina_2026-11-08.md).

## 3. Límites conocidos

- Las diferencias de tempo entre géneros siguen oyéndose cuando no hay una pista de tempo cercano: el motor solo iguala diferencias de hasta el 6 %. Con 7 pistas, el orden por tempo ayuda poco.
- Los géneros salen de las categorías de Jamendo y del tempo medido: nadie los revisó escuchando. Se corrigen editando `generos.txt`.
- Saltar una intro suave es una decisión de DJ. Una balada con 20 s de piano entraría cerca de su parte fuerte. El tope (30 s) y `AUDIT_SOUND_INTRO_SALTO=0` lo limitan.
