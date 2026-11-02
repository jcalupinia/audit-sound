#pragma once

// AutoMix: cerebro autónomo (port del Auto DJ de Mixxx, issue M3). Maneja 2 decks
// del motor, encadena pistas y conduce el crossfade por posición. No toca audio:
// solo lee estado de los decks (dj_position/dj_playing) y mueve el crossfader.

#include "dj_engine.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void* AutoMix;

// Proveedor de la siguiente pista: rellena path_out (hasta cap bytes) y devuelve 1
// si entregó una pista, 0 si no hay. Lo provee el selector (carpeta, Subsonic, …).
typedef int (*AutoMixNextTrackFn)(void* user, char* path_out, int cap);

AutoMix automix_create(DjEngine engine);
void automix_destroy(AutoMix am);

void automix_set_next_track(AutoMix am, AutoMixNextTrackFn cb, void* user);
void automix_set_transition_time(AutoMix am, double seconds);  // default 8
void automix_set_mode(AutoMix am, int mode);  // 0 = skip-silence, 1 = pista completa

int automix_enable(AutoMix am, int on);  // arranca/para el hilo. 1 = ok
void automix_skip(AutoMix am);           // fuerza la transición ya
int automix_state(AutoMix am);           // 0 disabled, 1 idle, 2 fading

#ifdef __cplusplus
}
#endif
