// Autoprueba headless del motor (issue C1).
// Verifica que el motor compila y CORRE en Linux sin Oboe: crea el motor,
// arranca el sink (OfflineSink), opcionalmente carga un archivo de audio y
// comprueba que la reproducción avanza. Con AUDIT_SOUND_PCM_OUT=<ruta> el sink
// vuelca PCM float32 intercalado para inspección.
//
// Uso:  engine_selftest [ruta_audio]

#include "dj_engine.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <thread>

int main(int argc, char** argv) {
  DjEngine e = dj_create();
  if (!e) {
    std::fprintf(stderr, "dj_create devolvió null\n");
    return 1;
  }

  if (!dj_start(e)) {
    std::fprintf(stderr, "dj_start falló\n");
    dj_destroy(e);
    return 1;
  }
  std::printf("motor arrancado; canales de salida = %d\n", dj_get_output_channels(e));

  bool loaded = false;
  if (argc > 1) {
    if (dj_load(e, 0, argv[1])) {
      loaded = true;
      dj_play(e, 0, 1);
      std::printf("cargado '%s': dur=%.2f s, bpm=%.2f\n", argv[1], dj_duration(e, 0),
                  dj_get_bpm(e, 0));
    } else {
      std::fprintf(stderr, "dj_load falló: %s\n", dj_last_error());
    }
  } else {
    std::printf("(sin archivo; solo se prueba arranque/stop del motor y el sink)\n");
  }

  const char* secsEnv = std::getenv("AUDIT_SOUND_SELFTEST_SECS");
  const int secs = (secsEnv && secsEnv[0]) ? std::atoi(secsEnv) : 2;
  std::this_thread::sleep_for(std::chrono::seconds(secs > 0 ? secs : 2));

  int rc = 0;
  if (loaded) {
    const double pos = dj_position(e, 0);
    std::printf("posición tras %d s = %.3f s\n", secs, pos);
    if (pos <= 0.0) {
      std::fprintf(stderr, "ERROR: la reproducción no avanzó\n");
      rc = 2;
    }
  }

  dj_stop(e);
  dj_destroy(e);
  if (rc == 0) {
    std::puts("selftest OK");
  }
  return rc;
}
