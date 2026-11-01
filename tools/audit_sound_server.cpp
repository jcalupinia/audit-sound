// audit_sound_server: proceso de larga vida que mantiene vivo el stream del DJ
// autónomo (Opción B). Reproduce en bucle los archivos de una carpeta y los emite
// por el sink configurado por entorno (Icecast en producción).
//
// NOTA: es un reproductor SECUENCIAL mínimo (placeholder) para desplegar y validar
// M1 (que el stream suene en el navegador/teléfono). El encadenado inteligente con
// transiciones (AutoMix) llega en M3 y el selector en M4; este server se sustituirá
// por ellos sin cambiar el sink ni el streaming.
//
// Env:
//   AUDIT_SOUND_MUSIC_DIR   carpeta con música (o argv[1])
//   AUDIT_SOUND_ICECAST_*   destino del stream (ver dj_engine)

#include "dj_engine.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

static bool isAudio(const std::string& ext) {
  static const std::vector<std::string> ok = {".mp3", ".wav", ".flac", ".opus",
                                               ".ogg", ".m4a", ".aac", ".m4b"};
  std::string e = ext;
  std::transform(e.begin(), e.end(), e.begin(), ::tolower);
  return std::find(ok.begin(), ok.end(), e) != ok.end();
}

int main(int argc, char** argv) {
  std::string dir;
  if (argc > 1) dir = argv[1];
  else if (const char* d = std::getenv("AUDIT_SOUND_MUSIC_DIR")) dir = d;
  if (dir.empty()) {
    std::fprintf(stderr, "uso: audit_sound_server <carpeta>  (o AUDIT_SOUND_MUSIC_DIR)\n");
    return 2;
  }

  std::vector<std::string> files;
  std::error_code ec;
  for (auto& p : fs::directory_iterator(dir, ec)) {
    if (p.is_regular_file() && isAudio(p.path().extension().string())) {
      files.push_back(p.path().string());
    }
  }
  std::sort(files.begin(), files.end());
  if (files.empty()) {
    std::fprintf(stderr, "no hay archivos de audio en: %s\n", dir.c_str());
    return 1;
  }
  std::printf("audit_sound_server: %zu pistas en %s\n", files.size(), dir.c_str());

  DjEngine e = dj_create();
  if (!dj_start(e)) {
    std::fprintf(stderr, "dj_start falló (¿sink/Icecast no disponible?)\n");
    dj_destroy(e);
    return 1;
  }

  const int deck = 0;
  for (;;) {  // bucle infinito sobre la carpeta
    for (const auto& f : files) {
      if (!dj_load(e, deck, f.c_str())) {
        std::fprintf(stderr, "saltando (no carga): %s (%s)\n", f.c_str(), dj_last_error());
        continue;
      }
      std::printf("reproduciendo: %s (%.1f s)\n", f.c_str(), dj_duration(e, deck));
      dj_play(e, deck, 1);
      while (dj_playing(e, deck)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
      }
    }
  }
  // inalcanzable
  dj_stop(e);
  dj_destroy(e);
  return 0;
}
