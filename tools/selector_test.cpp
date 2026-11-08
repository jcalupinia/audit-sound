// Prueba del selector inteligente (issue M4). Construye un pool sintético que
// cubre toda la rueda Camelot y mide, sobre muchas elecciones, qué fracción de
// transiciones consecutivas son armónicamente compatibles y que no se repite
// dentro de la ventana de cooldown.

#include "selector.h"

#include <cmath>
#include <cstdio>
#include <deque>
#include <string>

// Camelot / keysCompatible (copia para medir, igual que en selector.cpp).
static int camelotNum(int key, bool* minor) {
  static const int majNum[12] = {8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1};
  if (key < 0 || key > 23) return 0;
  if (key <= 11) { *minor = false; return majNum[key]; }
  *minor = true;
  return majNum[((key - 12) + 3) % 12];
}
static bool keysCompatible(int a, int b) {
  bool ma, mb;
  const int na = camelotNum(a, &ma), nb = camelotNum(b, &mb);
  if (!na || !nb) return false;
  if (na == nb) return true;
  const int dn = std::abs(na - nb);
  return ma == mb && (dn == 1 || dn == 11);
}

static int keyOfPath(const std::string& p) {
  // formato "k<KEY>_<v>"
  const size_t a = p.find('k');
  const size_t b = p.find('_');
  if (a == std::string::npos || b == std::string::npos) return -1;
  return std::atoi(p.substr(a + 1, b - a - 1).c_str());
}

int main() {
  SelectorConfig cfg;
  cfg.temperature = 0.4;
  cfg.cooldown = 5;
  Selector sel(cfg);

  // Pool: cada una de las 24 tonalidades, 3 variantes, BPM parecido (~124).
  for (int key = 0; key < 24; ++key)
    for (int v = 0; v < 3; ++v) {
      char path[64];
      std::snprintf(path, sizeof(path), "k%d_%d", key, v);
      sel.addTrack(path, 124.0f + (float)(v - 1) * 1.0f, key, 0.5f);
    }
  std::printf("pool: %zu pistas\n", sel.size());

  const int N = 400;
  int prevKey = -1;
  int compat = 0, transitions = 0, repeats = 0;
  std::deque<std::string> window;
  for (int i = 0; i < N; ++i) {
    const std::string p = sel.next();
    if (p.empty()) break;
    const int k = keyOfPath(p);
    if (prevKey >= 0) {
      ++transitions;
      if (keysCompatible(prevKey, k)) ++compat;
    }
    // anti-repetición dentro de cooldown (5)
    for (const auto& q : window)
      if (q == p) { ++repeats; break; }
    window.push_back(p);
    while ((int)window.size() > cfg.cooldown) window.pop_front();
    prevKey = k;
  }
  const double frac = transitions ? (double)compat / transitions : 0;
  std::printf("transiciones: %d  compatibles: %d (%.1f%%)  repeticiones<cooldown: %d\n",
              transitions, compat, 100.0 * frac, repeats);
  // notePlayed: una pista que puso la cola del agente no se repite justo después.
  Selector s2(cfg);
  s2.addTrack("a.mp3", 120, 0, 0.5f);
  s2.addTrack("b.mp3", 120, 0, 0.5f);
  s2.addTrack("c.mp3", 120, 0, 0.5f);
  int rep2 = 0;
  for (int i = 0; i < 200; ++i) {
    s2.notePlayed("b.mp3");
    if (s2.next() == "b.mp3") ++rep2;
  }
  std::printf("tras una pista de la cola, el selector la repitió %d de 200 veces\n", rep2);
  // Tempo: desde 100 BPM, con tonalidad neutra, elige la pista de 98 BPM antes que la de 135.
  SelectorConfig c3;
  c3.temperature = 0.01;
  c3.cooldown = 1;
  Selector s3(c3);
  s3.addTrack("ref.mp3", 100, -1, 0.5f);
  s3.addTrack("cerca.mp3", 98, -1, 0.5f);
  s3.addTrack("lejos.mp3", 135, -1, 0.5f);
  int cerca = 0;
  for (int i = 0; i < 50; ++i) {
    s3.notePlayed("ref.mp3");
    if (s3.next() == "cerca.mp3") ++cerca;
  }
  std::printf("desde 100 BPM eligió la de 98 BPM %d de 50 veces\n", cerca);
  const bool ok = frac >= 0.80 && repeats == 0 && rep2 == 0 && cerca == 50;
  std::printf("RESULTADO: %s\n", ok ? "OK (>=80%% armónico, sin repeticiones)" : "FALLO");
  return ok ? 0 : 1;
}
