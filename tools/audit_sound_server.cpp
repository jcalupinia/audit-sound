// audit_sound_server: DJ autónomo de larga vida (Opción B). Encadena pistas con
// transiciones (AutoMix, M3) y emite por el sink (Icecast en producción).
// Fuente de pistas:
//   - Navidrome/Subsonic si AUDIT_SOUND_SUBSONIC_URL está definido (M2), o
//   - carpeta local (AUDIT_SOUND_MUSIC_DIR o argv[1]).
//
// Env comunes:
//   AUDIT_SOUND_TRANSITION    segundos de transición (default 8)
//   AUDIT_SOUND_MIX_MODE      0 skip-silence (default), 1 pista completa
//   AUDIT_SOUND_ICECAST_*     destino del stream (ver dj_engine)
// Subsonic:
//   AUDIT_SOUND_SUBSONIC_URL / _USER / _PASS [ / _PLAYLIST ]

#include "automix.h"
#include "dj_engine.h"
#include "subsonic.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
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

// ---- Proveedor: carpeta local (en bucle) ----
struct LocalProvider {
  std::vector<std::string> files;
  std::atomic<size_t> idx{0};
};
static int nextLocal(void* user, char* out, int cap) {
  auto* pl = static_cast<LocalProvider*>(user);
  if (pl->files.empty()) return 0;
  const size_t i = pl->idx.fetch_add(1) % pl->files.size();
  std::snprintf(out, (size_t)cap, "%s", pl->files[i].c_str());
  return 1;
}

// ---- Proveedor: Navidrome/Subsonic (descarga a caché temporal) ----
struct SubsonicProvider {
  SubsonicClient* client = nullptr;
  std::string playlistId;  // vacío => random
  std::string tmpDir;
  std::mutex mu;
  std::deque<SubsonicSong> queue;
  std::deque<std::string> recent;  // archivos descargados (se purgan los viejos)
  long counter = 0;
};
static int nextSubsonic(void* user, char* out, int cap) {
  auto* p = static_cast<SubsonicProvider*>(user);
  std::lock_guard<std::mutex> lk(p->mu);
  if (p->queue.empty()) {
    auto songs = p->playlistId.empty() ? p->client->randomSongs(20)
                                       : p->client->playlistSongs(p->playlistId);
    for (auto& s : songs) p->queue.push_back(s);
  }
  if (p->queue.empty()) return 0;
  const SubsonicSong s = p->queue.front();
  p->queue.pop_front();
  const std::string suf = s.suffix.empty() ? "mp3" : s.suffix;
  const std::string path = p->tmpDir + "/t" + std::to_string(p->counter++) + "." + suf;
  if (!p->client->download(s, path)) return 0;
  std::snprintf(out, (size_t)cap, "%s", path.c_str());
  p->recent.push_back(path);
  while (p->recent.size() > 4) {  // conserva las 4 últimas (decks activos + buffer)
    std::remove(p->recent.front().c_str());
    p->recent.pop_front();
  }
  return 1;
}

int main(int argc, char** argv) {
  DjEngine e = dj_create();
  if (!dj_start(e)) {
    std::fprintf(stderr, "dj_start falló (¿sink/Icecast no disponible?)\n");
    dj_destroy(e);
    return 1;
  }

  AutoMix am = automix_create(e);
  const char* tt = std::getenv("AUDIT_SOUND_TRANSITION");
  automix_set_transition_time(am, (tt && tt[0]) ? std::atof(tt) : 8.0);
  const char* mm = std::getenv("AUDIT_SOUND_MIX_MODE");
  automix_set_mode(am, (mm && mm[0]) ? std::atoi(mm) : 0);

  // Mantener vivos los objetos del proveedor elegido.
  LocalProvider local;
  SubsonicClient* subClient = nullptr;
  SubsonicProvider sub;

  const char* subUrl = std::getenv("AUDIT_SOUND_SUBSONIC_URL");
  if (subUrl && subUrl[0]) {
    const char* u = std::getenv("AUDIT_SOUND_SUBSONIC_USER");
    const char* pw = std::getenv("AUDIT_SOUND_SUBSONIC_PASS");
    const char* pl = std::getenv("AUDIT_SOUND_SUBSONIC_PLAYLIST");
    subClient = new SubsonicClient(subUrl, u ? u : "", pw ? pw : "");
    std::string err;
    if (!subClient->ping(&err)) {
      std::fprintf(stderr, "Subsonic no responde: %s\n", err.c_str());
      return 1;
    }
    sub.client = subClient;
    sub.playlistId = pl ? pl : "";
    sub.tmpDir = "/tmp/audit_sound_cache";
    std::error_code ec;
    fs::create_directories(sub.tmpDir, ec);
    automix_set_next_track(am, nextSubsonic, &sub);
    std::printf("audit_sound_server: fuente Subsonic %s (DJ autónomo)\n", subUrl);
  } else {
    std::string dir;
    if (argc > 1) dir = argv[1];
    else if (const char* d = std::getenv("AUDIT_SOUND_MUSIC_DIR")) dir = d;
    if (dir.empty()) {
      std::fprintf(stderr,
                   "uso: audit_sound_server <carpeta>  (o AUDIT_SOUND_MUSIC_DIR, "
                   "o AUDIT_SOUND_SUBSONIC_URL)\n");
      return 2;
    }
    std::error_code ec;
    for (auto& p : fs::directory_iterator(dir, ec)) {
      if (p.is_regular_file() && isAudio(p.path().extension().string()))
        local.files.push_back(p.path().string());
    }
    std::sort(local.files.begin(), local.files.end());
    if (local.files.empty()) {
      std::fprintf(stderr, "no hay archivos de audio en: %s\n", dir.c_str());
      return 1;
    }
    automix_set_next_track(am, nextLocal, &local);
    std::printf("audit_sound_server: %zu pistas en %s (DJ autónomo)\n", local.files.size(),
                dir.c_str());
  }

  automix_enable(am, 1);
  for (;;) std::this_thread::sleep_for(std::chrono::seconds(3600));

  automix_destroy(am);
  delete subClient;
  dj_stop(e);
  dj_destroy(e);
  return 0;
}
