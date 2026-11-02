#pragma once

// Fachada C del modo autónomo para WebAssembly (P1): une el Selector inteligente
// (M4) y el AutoMix (M3) en una sola API C invocable por FFI desde el navegador, de
// modo que el motor WASM pueda ofrecer el modo automático igual que el servidor,
// compartiendo el MISMO motor C++ (sin duplicar la lógica de transición/selección).
//
// Uso típico en el Worker del navegador:
//   ctl = dj_auto_create(engine);
//   por cada pista:  dj_auto_add_track(ctl, "/ruta", bpm, key, energy);
//   dj_auto_set_transition(ctl, 8.0);
//   dj_auto_begin(ctl);           // adopta el deck que suena o carga la primera
//   periódicamente:  dj_auto_tick(ctl);   // avanza la máquina de estados
//   al pasar a manual:  dj_auto_end(ctl);  // deja de conducir el crossfader

#include "dj_engine.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void* AutoCtl;

AutoCtl dj_auto_create(DjEngine engine);
void dj_auto_destroy(AutoCtl ctl);

// Añade una pista al pool del selector (ruta en el FS virtual + metadatos ya
// analizados con dj_analyze_file / dj_analyze_silence).
void dj_auto_add_track(AutoCtl ctl, const char* path, float bpm, int key, float energy);

void dj_auto_set_transition(AutoCtl ctl, double seconds);
int dj_auto_begin(AutoCtl ctl);   // 1 = listo, 0 = sin pista inicial
void dj_auto_tick(AutoCtl ctl);
void dj_auto_end(AutoCtl ctl);
void dj_auto_skip(AutoCtl ctl);
int dj_auto_state(AutoCtl ctl);                       // 0 disabled, 1 idle, 2 fading
int dj_auto_current(AutoCtl ctl, char* out, int cap); // ruta de la pista en curso

#ifdef __cplusplus
}
#endif
