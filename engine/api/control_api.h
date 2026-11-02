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

#ifdef __cplusplus
}
#endif
