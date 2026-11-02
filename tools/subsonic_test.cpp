// Prueba del cliente Subsonic/Navidrome (issue M2).
// Uso: subsonic_test URL USER PASS   (o env SUB_URL/SUB_USER/SUB_PASS)
#include "subsonic.h"

#include <cstdio>
#include <cstdlib>
#include <string>

static std::string arg(int argc, char** argv, int i, const char* env) {
  if (argc > i) return argv[i];
  const char* e = std::getenv(env);
  return e ? e : "";
}

int main(int argc, char** argv) {
  const std::string url = arg(argc, argv, 1, "SUB_URL");
  const std::string user = arg(argc, argv, 2, "SUB_USER");
  const std::string pass = arg(argc, argv, 3, "SUB_PASS");
  if (url.empty()) {
    std::fprintf(stderr, "uso: subsonic_test URL USER PASS\n");
    return 2;
  }
  SubsonicClient c(url, user, pass);
  std::string err;
  if (!c.ping(&err)) {
    std::fprintf(stderr, "ping falló: %s\n", err.c_str());
    return 1;
  }
  std::printf("ping OK (token MD5 aceptado por el servidor)\n");

  auto songs = c.randomSongs(3);
  std::printf("randomSongs: %zu\n", songs.size());
  for (auto& s : songs)
    std::printf("  id=%s suffix=%s title=%s\n", s.id.c_str(), s.suffix.c_str(), s.title.c_str());
  if (songs.empty()) {
    std::fprintf(stderr, "sin canciones\n");
    return 1;
  }

  const std::string out = "/tmp/subsonic_dl." + songs[0].suffix;
  if (!c.download(songs[0], out)) {
    std::fprintf(stderr, "download falló\n");
    return 1;
  }
  std::printf("descargado: %s\n", out.c_str());
  std::puts("subsonic_test OK");
  return 0;
}
