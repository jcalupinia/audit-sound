// Prueba del detector de silencio (-60 dB) + energía RMS (issue M2).
// Uso: silence_test archivo
#include "dj_engine.h"
#include <cstdio>

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "uso: silence_test archivo\n");
    return 2;
  }
  double first = -9, last = -9;
  float energy = -1;
  if (!dj_analyze_silence(argv[1], &first, &last, &energy)) {
    std::fprintf(stderr, "dj_analyze_silence falló\n");
    return 1;
  }
  std::printf("first_sound=%.3f s  last_sound=%.3f s  energy_rms=%.4f\n", first, last, energy);
  return 0;
}
