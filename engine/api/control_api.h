#pragma once

// Control API (issue M5): servidor HTTP embebido (libmicrohttpd) que expone
// login + estado + comandos del DJ autónomo para el frontend web.
//
//   POST /api/login?user=..&pass=..   -> {"token":"..."}
//   GET  /api/status?token=..         -> estado (now-playing, bpm, modo, transición)
//   POST /api/command?token=..&action=skip|set_transition|set_mode[&value=..]

#include "automix.h"
#include "dj_engine.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void* ControlApi;

ControlApi control_api_start(int port, const char* user, const char* pass, DjEngine engine,
                             AutoMix automix);
void control_api_stop(ControlApi api);

#ifdef __cplusplus
}
#endif
