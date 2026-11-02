// Implementación de la fachada C del modo autónomo (P1). Posee un Selector y un
// AutoMix y los cablea: el AutoMix pide la siguiente pista al Selector por su
// callback. No tiene estado propio más allá de eso.

#include "auto_facade.h"

#include "automix/automix.h"
#include "selector/selector.h"

namespace {
struct AutoCtlImpl {
  Selector sel;          // pool + puntuación (armonía/BPM/energía/frescura)
  AutoMix am = nullptr;  // máquina de estados + crossfade por posición
};
}  // namespace

extern "C" {

AutoCtl dj_auto_create(DjEngine engine) {
  auto* c = new AutoCtlImpl();  // Selector se construye por defecto en el sitio
  c->am = automix_create(engine);
  automix_set_next_track(c->am, Selector::nextTrackCb, &c->sel);
  return c;
}

void dj_auto_destroy(AutoCtl ctl) {
  auto* c = static_cast<AutoCtlImpl*>(ctl);
  if (!c) return;
  automix_destroy(c->am);
  delete c;
}

void dj_auto_add_track(AutoCtl ctl, const char* path, float bpm, int key, float energy) {
  if (!ctl || !path) return;
  static_cast<AutoCtlImpl*>(ctl)->sel.addTrack(path, bpm, key, energy);
}

void dj_auto_set_transition(AutoCtl ctl, double seconds) {
  automix_set_transition_time(static_cast<AutoCtlImpl*>(ctl)->am, seconds);
}

int dj_auto_begin(AutoCtl ctl) {
  return automix_begin(static_cast<AutoCtlImpl*>(ctl)->am);
}

void dj_auto_tick(AutoCtl ctl) { automix_tick(static_cast<AutoCtlImpl*>(ctl)->am); }

void dj_auto_end(AutoCtl ctl) { automix_end(static_cast<AutoCtlImpl*>(ctl)->am); }

void dj_auto_skip(AutoCtl ctl) { automix_skip(static_cast<AutoCtlImpl*>(ctl)->am); }

int dj_auto_state(AutoCtl ctl) { return automix_state(static_cast<AutoCtlImpl*>(ctl)->am); }

int dj_auto_current(AutoCtl ctl, char* out, int cap) {
  return automix_current_path(static_cast<AutoCtlImpl*>(ctl)->am, out, cap);
}

}  // extern "C"
