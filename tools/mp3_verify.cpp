// Verificador de MP3 (issue D1). Re-decodifica un archivo MP3 con dr_mp3 y
// reporta si es un MP3 válido, su duración y el nivel de pico (no-silencio).
// Devuelve 0 si es válido y con audio; !=0 si falla.
//
// Uso:  mp3_verify archivo.mp3

#define DR_MP3_IMPLEMENTATION
#include "dr_mp3.h"

#include <cmath>
#include <cstdio>
#include <vector>

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "uso: mp3_verify archivo.mp3\n");
    return 2;
  }
  drmp3 mp3;
  if (!drmp3_init_file(&mp3, argv[1], nullptr)) {
    std::fprintf(stderr, "ERROR: no es un MP3 decodificable: %s\n", argv[1]);
    return 1;
  }
  const unsigned ch = mp3.channels;
  const unsigned sr = mp3.sampleRate;
  std::vector<float> buf(4096 * ch);
  drmp3_uint64 total = 0;
  float peak = 0.0f;
  for (;;) {
    drmp3_uint64 n = drmp3_read_pcm_frames_f32(&mp3, 4096, buf.data());
    if (n == 0) break;
    for (drmp3_uint64 i = 0; i < n * ch; ++i) {
      peak = std::fmax(peak, std::fabs(buf[(size_t)i]));
    }
    total += n;
  }
  drmp3_uninit(&mp3);

  const double seconds = sr ? (double)total / sr : 0.0;
  std::printf("MP3 válido: ch=%u sr=%u, cuadros=%llu (%.2f s), pico=%.4f\n",
              ch, sr, (unsigned long long)total, seconds, peak);
  if (total == 0) {
    std::fprintf(stderr, "ERROR: MP3 sin cuadros de audio\n");
    return 1;
  }
  if (peak <= 0.01f) {
    std::fprintf(stderr, "ERROR: MP3 en silencio\n");
    return 1;
  }
  std::puts("mp3_verify OK (MP3 válido y con audio)");
  return 0;
}
