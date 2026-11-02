// Autoprueba del motor WASM (corre en el worker vía PROXY_TO_PTHREAD, donde el
// hilo del cache funciona). Carga /track.wav (embebido), reproduce, renderiza y
// reporta el pico del PCM. Se lee por la consola del navegador.
#include "dj_engine.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <thread>
#include <vector>

int main() {
  DjEngine e = dj_create();
  dj_start(e);
  const int ok = dj_load(e, 0, "/track.wav");
  std::printf("SELFTEST load=%d dur=%.2f bpm=%.1f\n", ok, dj_duration(e, 0), dj_get_bpm(e, 0));
  dj_play(e, 0, 1);
  std::this_thread::sleep_for(std::chrono::milliseconds(1200));

  const int frames = 2048, ch = 2, n = frames * ch;
  std::vector<float> buf(n);
  float peak = 0.0f;
  for (int k = 0; k < 30; ++k) {
    dj_render(e, buf.data(), frames, ch);
    for (int i = 0; i < n; ++i) peak = std::fmax(peak, std::fabs(buf[i]));
  }
  std::printf("SELFTEST_RESULT peak=%.4f pos=%.2f\n", peak, dj_position(e, 0));
  dj_stop(e);
  dj_destroy(e);
  return 0;
}
