#pragma once

// Control API (issues M5 + M6 handoff): servidor HTTP embebido (libmicrohttpd)
// que expone login + estado + comandos del DJ autónomo para el frontend web.
//
//   POST /api/login?user=..&pass=..[&name=..]  -> {"token":"..","name":"..","youAreController":bool}
//   GET  /api/status?token=..         -> estado + {"controller":"..","youAreController":bool}
//   POST /api/command?token=..&action=..   (solo el dispositivo que tiene el control; si no, 409)
//   POST /api/control/take?token=..   -> este dispositivo toma el control (handoff, M6)
//   POST /api/control/release?token=.. -> suelta el control (queda sin controlador)
//
// M6 — handoff: cada dispositivo recibe su PROPIO token al hacer login. Solo UNO es
// el "controlador" a la vez; el primero en entrar lo toma, y cualquier otro puede
// arrebatarlo con /api/control/take. Los comandos solo los acepta el controlador.

#include "automix.h"
#include "dj_engine.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void* ControlApi;

ControlApi control_api_start(int port, const char* user, const char* pass, DjEngine engine,
                             AutoMix automix);
void control_api_stop(ControlApi api);

// Carga el catálogo (para el modo manual: elegir pista por deck). Llamar una vez
// por pista antes/después de start.
void control_api_add_track(ControlApi api, const char* title, const char* path);

// Fase 2 · B1 — igual que control_api_add_track pero con los metadatos del análisis
// (BPM, tonalidad 0..11 mayor / 12..23 menor / -1, energía 0..1, duración en segundos).
// GET /api/tracks los expone; los clientes antiguos los ignoran (cambio aditivo).
void control_api_add_track_meta(ControlApi api, const char* title, const char* path, float bpm, int key,
                                float energy, double duration);

// Género de la pista `index` (orden de alta). GET /api/tracks lo publica como "genre"; vacío = no se
// publica. Lo usa el agente para órdenes como «pon merengue» (cambio aditivo).
void control_api_set_track_genre(ControlApi api, int index, const char* genre);

// Fase 2 · B2 — cola del agente. La llama el callback de "siguiente pista" del AutoMix
// ANTES que el Selector: si hay pistas encoladas devuelve 1 y la ruta de la primera
// (descarta las que ya no existen en disco); si la cola está vacía devuelve 0 y el
// llamador usa el Selector sin cambios. Usa un cerrojo propio (no el de la API HTTP).
int control_api_next_queued(ControlApi api, char* path_out, int cap);

#ifdef __cplusplus
}
#endif
