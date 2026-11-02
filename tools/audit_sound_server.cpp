// audit_sound_server: DJ autónomo de larga vida (Opción B). Reproduce una carpeta
// con transiciones automáticas (AutoMix, M3) y emite por el sink (Icecast en
// producción). El AutoMix encadena las pistas; aquí solo proveemos la lista.
//
// Env:
//   AUDIT_SOUND_MUSIC_DIR     carpeta con música (o argv[1])
//   AUDIT_SOUND_TRANSITION    segundos de transición (default 8)
//   AUDIT_SOUND_MIX_MODE      0 skip-silence (default), 1 pista completa
//   AUDIT_SOUND_ICECAST_*     destino del stream (ver dj_engine)

#include "automix.h"
#include "dj_engine.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <mutex>
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

// Proveedor de pistas: recorre la carpeta en bucle (placeholder del selector M4).
struct Playlist {
  std::vector<std::string> files;
  std::atomic<size_t> idx{0};
};

static int nextTrack(void* user, char* out, int cap) {
  auto* pl = static_cast<Playlist*>(user);
  if (pl->files.empty()) return 0;
  const size_t i = pl->idx.fetch_add(1) % pl->files.size();
  std::snprintf(out, (size_t)cap, "%s", pl->files[i].c_str());
  return 1;
}

int main(int argc, char** argv) {
  std::string dir;
  if (argc > 1) dir = argv[1];
  else if (const char* d = std::getenv("AUDIT_SOUND_MUSIC_DIR")) dir = d;
  if (dir.empty()) {
    std::fprintf(stderr, "uso: audit_sound_server <carpeta>  (o AUDIT_SOUND_MUSIC_DIR)\n");
    return 2;
  }

  Playlist pl;
  std::error_code ec;
  for (auto& p : fs::directory_iterator(dir, ec)) {
    if (p.is_regular_file() && isAudio(p.path().extension().string())) {
      pl.files.push_back(p.path().string());
    }
  }
  std::sort(pl.files.begin(), pl.files.end());
  if (pl.files.empty()) {
    std::fprintf(stderr, "no hay archivos de audio en: %s\n", dir.c_str());
    return 1;
  }
  std::printf("audit_sound_server: %zu pistas en %s (DJ autónomo)\n", pl.files.size(),
              dir.c_str());

  DjEngine e = dj_create();
  if (!dj_start(e)) {
    std::fprintf(stderr, "dj_start falló (¿sink/Icecast no disponible?)\n");
    dj_destroy(e);
    return 1;
  }

  AutoMix am = automix_create(e);
  automix_set_next_track(am, nextTrack, &pl);
  const char* tt = std::getenv("AUDIT_SOUND_TRANSITION");
  automix_set_transition_time(am, (tt && tt[0]) ? std::atof(tt) : 8.0);
  const char* mm = std::getenv("AUDIT_SOUND_MIX_MODE");
  automix_set_mode(am, (mm && mm[0]) ? std::atoi(mm) : 0);
  automix_enable(am, 1);

  // Corre indefinidamente (el AutoMix vive en su propio hilo).
  for (;;) std::this_thread::sleep_for(std::chrono::seconds(3600));

  automix_destroy(am);
  dj_stop(e);
  dj_destroy(e);
  return 0;
}
