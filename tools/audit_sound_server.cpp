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
#include "control_api.h"
#include "dj_engine.h"
#include "selector.h"
#include "subsonic.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <csignal>
#include <string>
#include <thread>
#include <unordered_map>
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
// Títulos para el stream: ruta del archivo -> «Artista - Tema». Para archivos locales se usa el
// nombre del archivo (la biblioteca libre ya viene como «Artista - Tema.mp3»); para Subsonic, el
// título que entrega el servidor (sus archivos temporales se llaman t0.mp3, t1.mp3…).
static std::mutex gTitlesMu;
static std::unordered_map<std::string, std::string> gTitles;
static std::string titleFor(const std::string& path) {
  {
    std::lock_guard<std::mutex> lk(gTitlesMu);
    auto it = gTitles.find(path);
    if (it != gTitles.end()) return it->second;
  }
  return fs::path(path).stem().string();
}

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
  if (!s.title.empty()) {
    std::lock_guard<std::mutex> lk(gTitlesMu);
    gTitles[path] = s.title;
  }
  p->recent.push_back(path);
  while (p->recent.size() > 4) {  // conserva las 4 últimas (decks activos + buffer)
    std::remove(p->recent.front().c_str());
    p->recent.pop_front();
  }
  return 1;
}

// Fase 2 · B2: la cola del agente tiene prioridad; si está vacía, el Selector decide
// exactamente como antes (su algoritmo no se modifica). 'api' se fija cuando arranca la
// Control API: hasta entonces solo decide el Selector.
struct NextTrackChain {
  std::atomic<void*> api{nullptr};
  Selector* sel = nullptr;
};
static int nextChained(void* user, char* out, int cap) {
  auto* c = static_cast<NextTrackChain*>(user);
  ControlApi a = c->api.load();
  if (a && control_api_next_queued(a, out, cap)) {
    if (c->sel) c->sel->notePlayed(out);  // el Selector no la repite justo después
    return 1;
  }
  return Selector::nextTrackCb(c->sel, out, cap);
}

// Géneros de la biblioteca: archivo opcional «generos.txt» en la carpeta de música, una línea por
// pista con «Título|género» (Título = nombre del archivo sin extensión). Líneas con # se ignoran.
static std::map<std::string, std::string> loadGenres(const std::string& dir) {
  std::map<std::string, std::string> g;
  std::ifstream in(fs::path(dir) / "generos.txt");
  std::string line;
  while (std::getline(in, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    const auto bar = line.rfind('|');
    if (line.empty() || line[0] == '#' || bar == std::string::npos) continue;
    std::string genre = line.substr(bar + 1);
    if (!genre.empty()) g[line.substr(0, bar)] = genre;
  }
  return g;
}

struct TrackMeta {
  float bpm = 0, energy = -1;
  int key = -1;
  double duration = 0;
};

int main(int argc, char** argv) {
#ifdef SIGPIPE
  // H-23: si Icecast cierra la conexión mientras el sink le escribe, el núcleo envía
  // SIGPIPE y, por defecto, mata el proceso (código 141): el stream se corta y no llega
  // a actuar la reconexión (IcecastByteSink::tryReconnect). Ignorándolo, la escritura
  // devuelve EPIPE, el sink lo trata como desconexión y se reconecta solo.
  std::signal(SIGPIPE, SIG_IGN);
#endif
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
  Selector selector;
  SubsonicClient* subClient = nullptr;
  SubsonicProvider sub;
  NextTrackChain chain;
  chain.sel = &selector;
  std::vector<TrackMeta> metas;
  std::string localDir;  // carpeta local de música (para generos.txt)

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
    localDir = dir;
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
    // Selector inteligente (M4): analizar cada pista (BPM/tonalidad/energía).
    std::printf("audit_sound_server: analizando %zu pistas para el selector…\n",
                local.files.size());
    for (const auto& f : local.files) {
      float bpm = 0, energy = 0;
      int key = -1;
      float off = 0;
      dj_analyze_file(f.c_str(), &bpm, &key, &off);
      double first = 0, last = -1;
      dj_analyze_silence(f.c_str(), &first, &last, &energy);
      selector.addTrack(f, bpm, key, energy);
      metas.push_back({bpm, energy, key, dj_file_duration(f.c_str())});  // B1: se publican en /api/tracks
    }
    automix_set_next_track(am, nextChained, &chain);
    std::printf("audit_sound_server: %zu pistas, selección inteligente (DJ autónomo)\n",
                selector.size());
  }

  automix_enable(am, 1);

  // Vigilante del título: cuando el AutoMix termina una transición, la pista que suena cambia y se
  // publica su título en el stream (los oyentes lo ven en el reproductor; Icecast, en status-json).
  std::thread([e, am] {
    std::string last;
    char buf[2048];
    for (;;) {
      std::this_thread::sleep_for(std::chrono::milliseconds(500));
      if (!automix_current_path(am, buf, sizeof buf)) continue;
      const std::string t = titleFor(buf);
      if (t.empty() || t == last) continue;
      last = t;
      dj_set_stream_title(e, t.c_str());
      std::printf("en el aire: %s\n", t.c_str());
      std::fflush(stdout);
    }
  }).detach();

  // Control API (M5): login + estado + comandos para el frontend.
  ControlApi api = nullptr;
  const char* apiUser = std::getenv("AUDIT_SOUND_API_USER");
  const char* apiPass = std::getenv("AUDIT_SOUND_API_PASS");
  if (apiUser && apiUser[0]) {
    const char* portEnv = std::getenv("AUDIT_SOUND_API_PORT");
    const int apiPort = (portEnv && portEnv[0]) ? std::atoi(portEnv) : 8787;
    api = control_api_start(apiPort, apiUser, apiPass ? apiPass : "", e, am);
    if (api) {
      // Catálogo para el modo manual (pistas locales).
      const auto genres = loadGenres(localDir);
      if (!genres.empty()) std::printf("géneros: %zu pistas con género (generos.txt)\n", genres.size());
      for (size_t i = 0; i < local.files.size(); ++i) {
        const std::string& f = local.files[i];
        const std::string title = fs::path(f).stem().string();
        if (i < metas.size())
          control_api_add_track_meta(api, title.c_str(), f.c_str(), metas[i].bpm, metas[i].key, metas[i].energy,
                                     metas[i].duration);
        else
          control_api_add_track(api, title.c_str(), f.c_str());
        auto it = genres.find(title);
        if (it != genres.end()) control_api_set_track_genre(api, (int)i, it->second.c_str());
      }
      chain.api.store(api);  // desde aquí la cola del agente participa en la selección
      std::printf("Control API en el puerto %d (usuario '%s', %zu pistas)\n", apiPort, apiUser,
                  local.files.size());
    }
  }

  for (;;) std::this_thread::sleep_for(std::chrono::seconds(3600));

  control_api_stop(api);
  automix_destroy(am);
  delete subClient;
  dj_stop(e);
  dj_destroy(e);
  return 0;
}
