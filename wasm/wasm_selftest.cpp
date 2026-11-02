// Autoprueba del motor WASM (single-thread). Carga /track.wav (embebido), reproduce
// y renderiza bloques; como el motor avanza la posición dentro de cada dj_render, no
// hace falta dormir en tiempo real. Reporta el pico del PCM por la consola.
#include "dj_engine.h"

#include <cmath>
#include <cstdio>
#include <vector>

int main() {
  DjEngine e = dj_create();
  dj_start(e);
  const int ok = dj_load(e, 0, "/track.wav");
  std::printf("SELFTEST load=%d dur=%.2f bpm=%.1f\n", ok, dj_duration(e, 0), dj_get_bpm(e, 0));
  dj_play(e, 0, 1);

  const int frames = 2048, ch = 2, n = frames * ch;
  std::vector<float> buf(n);
  float peak = 0.0f;
  for (int k = 0; k < 60; ++k) {
    dj_render(e, buf.data(), frames, ch);
    for (int i = 0; i < n; ++i) peak = std::fmax(peak, std::fabs(buf[i]));
  }
  std::printf("SELFTEST_RESULT peak=%.4f pos=%.2f\n", peak, dj_position(e, 0));
  dj_stop(e);
  dj_destroy(e);
  return 0;
}
