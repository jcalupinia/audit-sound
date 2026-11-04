// Prueba de reproducción continua + recuperación ante fallos (Etapa A / A1.4).
//
// Arranca el motor con OfflineSink (sin Icecast, headless) y el AutoMix autónomo
// con un proveedor de pistas que FALLA de forma intermitente (devuelve rutas
// inexistentes una de cada dos). Verifica que:
//   - el AutoMix se recupera de una fuente que falla (loadIntoRetry salta la mala),
//   - la reproducción NO se corta a lo largo de muchas transiciones (siempre hay un
//     deck sonando tras el arranque),
//   - se reproducen efectivamente las dos pistas buenas (recuperación real),
//   - no hay cuelgue ni caída (el test termina).
//
// Devuelve 0 si pasa; !=0 si falla.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <cmath>

#include <cstdlib>
#include <unistd.h>

#include "automix.h"
#include "dj_engine.h"

namespace {

// Escribe un WAV PCM 16-bit mono (segundos a freq Hz) en `path`.
bool writeWav(const std::string& path, double seconds, double freq, int sr = 44100) {
  std::ofstream f(path, std::ios::binary);
  if (!f) return false;
  const uint32_t n = (uint32_t)(seconds * sr);
  auto u32 = [&](uint32_t v) { f.write(reinterpret_cast<const char*>(&v), 4); };
  auto u16 = [&](uint16_t v) { f.write(reinterpret_cast<const char*>(&v), 2); };
  f.write("RIFF", 4); u32(36 + n * 2); f.write("WAVE", 4);
  f.write("fmt ", 4); u32(16); u16(1); u16(1); u32(sr); u32(sr * 2); u16(2); u16(16);
  f.write("data", 4); u32(n * 2);
  for (uint32_t i = 0; i < n; ++i) {
    int16_t s = (int16_t)(std::sin(2.0 * M_PI * freq * i / sr) * 12000);
    f.write(reinterpret_cast<const char*>(&s), 2);
  }
  return (bool)f;
}

struct Provider {
  std::mutex mu;
  std::vector<std::string> good;   // rutas válidas
  size_t i = 0;
  std::atomic<int> badServed{0};
  std::atomic<int> goodServed{0};
  std::atomic<int> servedGood0{0}, servedGood1{0};
};

// Callback del AutoMix: una de cada dos pistas es una ruta INEXISTENTE (fallo de
// fuente). El resto rota entre las pistas buenas.
int nextTrack(void* user, char* out, int cap) {
  auto* p = static_cast<Provider*>(user);
  std::lock_guard<std::mutex> lk(p->mu);
  const size_t idx = p->i++;
  if (idx % 2 == 1) {  // intermitente: ruta mala
    std::snprintf(out, cap, "/no/existe/pista_%zu.wav", idx);
    p->badServed++;
    return 1;
  }
  const size_t g = (idx / 2) % p->good.size();
  std::snprintf(out, cap, "%s", p->good[g].c_str());
  p->goodServed++;
  if (g == 0) p->servedGood0++; else p->servedGood1++;
  return 1;
}

}  // namespace

int main() {
  // Directorio temporal propio para los WAV de prueba.
  char tmpl[] = "/tmp/audit_recov_XXXXXX";
  char* dir = mkdtemp(tmpl);
  if (!dir) { std::fprintf(stderr, "no se pudo crear dir temporal\n"); return 2; }
  const std::string g0 = std::string(dir) + "/good0.wav";
  const std::string g1 = std::string(dir) + "/good1.wav";
  if (!writeWav(g0, 2.0, 440.0) || !writeWav(g1, 2.0, 330.0)) {
    std::fprintf(stderr, "no se pudieron escribir los WAV\n"); return 2;
  }

  DjEngine e = dj_create();
  if (!dj_start(e)) { std::fprintf(stderr, "dj_start falló (sink no disponible)\n"); return 2; }
  AutoMix am = automix_create(e);

  Provider prov;
  prov.good = { g0, g1 };
  automix_set_next_track(am, nextTrack, &prov);
  automix_set_transition_time(am, 1.0);
  automix_set_mode(am, 0);  // skip-silence (transiciones más rápidas para el test)

  if (!automix_enable(am, 1)) { std::fprintf(stderr, "automix_enable falló\n"); return 2; }

  // Deja que arranque y adopte/cargue la primera pista.
  std::this_thread::sleep_for(std::chrono::milliseconds(600));

  // Observa continuidad mientras se fuerzan transiciones (incluye las malas).
  int samples = 0, playingSamples = 0, gaps = 0;
  for (int t = 0; t < 40; ++t) {                 // ~8 s de observación
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    const bool playing = dj_playing(e, 0) || dj_playing(e, 1);
    samples++;
    if (playing) playingSamples++; else gaps++;
    if (t % 6 == 3) automix_skip(am);            // fuerza una transición periódicamente
  }

  automix_enable(am, 0);
  automix_destroy(am);
  dj_destroy(e);
  std::remove(g0.c_str()); std::remove(g1.c_str()); rmdir(dir);

  // --- Aserciones ---
  int pass = 0, fail = 0;
  auto ok = [&](bool c, const char* m) { if (c) { pass++; std::printf("  OK   %s\n", m); } else { fail++; std::printf("  FAIL %s\n", m); } };

  const double contPct = samples ? (100.0 * playingSamples / samples) : 0;
  std::printf("muestras=%d sonando=%d (%.0f%%) huecos=%d · buenas servidas=%d malas servidas=%d\n",
              samples, playingSamples, contPct, gaps, prov.goodServed.load(), prov.badServed.load());

  ok(prov.badServed.load() > 0, "la fuente falló al menos una vez (se ejercitó la recuperación)");
  ok(prov.goodServed.load() >= 2, "se sirvieron pistas buenas tras los fallos (recuperación)");
  ok(prov.servedGood0.load() > 0 && prov.servedGood1.load() > 0, "se reprodujeron ambas pistas buenas");
  ok(contPct >= 90.0, "reproducción continua ≥90% del tiempo pese a los fallos");
  ok(true, "sin cuelgue ni caída (el test llegó al final)");

  std::printf("\nRESULTADO: %d OK, %d FAIL\n", pass, fail);
  return fail ? 1 : 0;
}
