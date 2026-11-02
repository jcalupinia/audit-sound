#pragma once

// Selector musical inteligente (issue M4). Elige la siguiente pista puntuando
// candidatas contra la última entregada: armonía (Camelot), cercanía de BPM,
// energía y frescura (anti-repetición), con muestreo ponderado (temperatura).
// Alimenta al AutoMix por su callback de "siguiente pista".

#include <cstddef>
#include <string>

struct SelectorConfig {
  double wHarmony = 0.40;
  double wTempo = 0.30;
  double wEnergy = 0.15;
  double wFresh = 0.15;
  double temperature = 0.5;  // 0→siempre la mejor; alto→más variedad
  int topN = 8;
  int cooldown = 5;  // no repetir dentro de las últimas N elecciones
};

class Selector {
 public:
  explicit Selector(SelectorConfig cfg = {});

  void addTrack(const std::string& path, float bpm, int key, float energy);
  std::size_t size() const;

  // Elige la siguiente pista (ruta). "" si no hay. Actualiza referencia e historial.
  std::string next();

  // Adaptador para AutoMix (AutoMixNextTrackFn): rellena out y devuelve 1/0.
  static int nextTrackCb(void* user, char* out, int cap);

 private:
  struct Impl;
  Impl* p_;

 public:
  ~Selector();
};
