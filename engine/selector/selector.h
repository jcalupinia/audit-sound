#pragma once

// Selector musical inteligente (issue M4). Elige la siguiente pista puntuando
// candidatas contra la última entregada: armonía (Camelot), cercanía de BPM,
// energía y frescura (anti-repetición), con muestreo ponderado (temperatura).
// Alimenta al AutoMix por su callback de "siguiente pista".

#include <cstddef>
#include <string>

struct SelectorConfig {
  // Tempo con más peso que la armonía (2026-11-08): con géneros de BPM muy distintos (bachata ~96,
  // salsa ~100, merengue ~135) el salto de ritmo se oye más que un choque de tonalidad.
  double wHarmony = 0.30;
  double wTempo = 0.40;
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

  // Registra una pista que eligió OTRO (la cola del agente): pasa a ser la referencia y entra en
  // el historial, para que el Selector no la repita justo después.
  void notePlayed(const std::string& path);

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
